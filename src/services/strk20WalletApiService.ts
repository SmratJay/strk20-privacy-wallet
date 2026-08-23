/**
 * @file src/services/strk20WalletApiService.ts
 * @description Generic STRK20 Wallet API lane (Privacy Wallet API / WalletAccountV6).
 *
 * THIS IS LANE A: privacy-enabled wallet → Wallet API → STRK20 pool.
 *
 * The wallet owns the user's privacy state (viewing keys, channels, notes), performs
 * SNIP-36 proof generation, and submits the private transaction. The dapp NEVER:
 *   - inspects or stores viewing keys / notes / proofs
 *   - reconstructs private notes
 *   - writes financial state to localStorage
 *   - falls back to public ERC-20 transfers
 *
 * This lane is SEPARATE from PEL private perps (LANE B: raw SDK + computeAndInvoke to
 * PELPerpsSTRK20Bridge), which lives in src/services/strk20SdkService.ts and still
 * requires the operator proving/discovery stack.
 *
 * Authoritative spec: starkware-libs/starknet-specs `wallet-api/wallet_rpc.json` (v0.10.3).
 * Methods used here:
 *   wallet_supportedWalletApi / wallet_supportedSpecs   (capability)
 *   wallet_requestChainId                               (chain)
 *   wallet_strk20InvokeTransaction                      (deposit / transfer / withdraw)
 *   wallet_strk20Balances                               (private balances)
 *
 * STRK20 actions used: deposit, transfer, withdraw (the wallet adds its own fee action).
 */

export const SN_SEPOLIA_CHAIN_ID = '0x534e5f5345504f4c4941'; // ASCII "SN_SEPOLIA"
export const SN_MAIN_CHAIN_ID = '0x534e5f4d41494e'; // ASCII "SN_MAIN"
export const MIN_STRK20_WALLET_API_VERSION = '0.10';

export type WalletApiLaneState =
  | 'CONNECT_WALLET'
  | 'WRONG_NETWORK'
  | 'PRIVACY_WALLET_REQUIRED'
  | 'READY';

export interface WalletApiStatus {
  connected: boolean;
  walletName?: string;
  hasProvider: boolean;
  supportedWalletApiVersions: string[];
  supportedSpecVersions: string[];
  supportsStrk20: boolean;
  chainId: string | null;
  state: WalletApiLaneState;
}

export interface WalletApiProvider {
  request: (call: { type: string; params?: unknown }) => Promise<unknown>;
}

export interface PrivateBalanceEntry {
  token: string;
  balance: bigint;
}

export interface WalletActionReceipt {
  transactionHash: string;
}

/**
 * Session-level private-balance access state. This is the app's memory of whether the
 * connected wallet's "share private balances" consent has been granted for the current
 * wallet session. It is IN-MEMORY only — never persisted (no viewing keys, notes, or
 * balances are stored).
 */
export type WalletBalancePermission = 'UNKNOWN' | 'GRANTED' | 'DENIED';

// ─── Capability helpers ───────────────────────────────────────────────────────

/** True when a "0.10.x"-style version string is >= the minimum STRK20 Wallet API version. */
function isStrk20CapableVersion(version: string): boolean {
  const [minMajor, minMinor] = MIN_STRK20_WALLET_API_VERSION.split('.').map(Number);
  const cleaned = version.split('-')[0].split('.');
  const major = Number.parseInt(cleaned[0] ?? '0', 10);
  const minor = Number.parseInt(cleaned[1] ?? '0', 10);
  if (major !== minMajor) return major > minMajor;
  return minor >= minMinor;
}

function toHexFelt(value: bigint): string {
  return '0x' + value.toString(16);
}

// ─── Provider resolution ──────────────────────────────────────────────────────

/**
 * Find the connected wallet's Wallet API provider — any object exposing `request`.
 * Only the connected wallet is considered (never a random injected wallet).
 */
export function resolveWalletApiProvider(wallet: any): WalletApiProvider | null {
  if (!wallet) return null;
  const candidates: unknown[] = [
    wallet.rawWallet,
    wallet.rawWallet?.provider,
    wallet.walletAccount,
    wallet.walletAccount?.provider,
    wallet.provider,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof (candidate as WalletApiProvider).request === 'function') {
      return candidate as WalletApiProvider;
    }
  }
  return null;
}

// ─── Status / capability / chain ──────────────────────────────────────────────

/** Capability + chain detection. Authoritative; never infers from wallet name. */
export async function getWalletApiStatus(wallet: any): Promise<WalletApiStatus> {
  const provider = resolveWalletApiProvider(wallet);
  const connected = Boolean(wallet?.isConnected) || Boolean(provider);

  if (!provider) {
    return {
      connected,
      walletName: wallet?.walletName,
      hasProvider: false,
      supportedWalletApiVersions: [],
      supportedSpecVersions: [],
      supportsStrk20: false,
      chainId: null,
      state: 'CONNECT_WALLET',
    };
  }

  let apiVersions: string[] = [];
  let specVersions: string[] = [];
  try {
    const r = (await provider.request({ type: 'wallet_supportedWalletApi' })) as unknown;
    apiVersions = Array.isArray(r) ? r.map((v) => String(v)) : [];
  } catch {
    apiVersions = [];
  }
  try {
    const r = (await provider.request({ type: 'wallet_supportedSpecs' })) as unknown;
    specVersions = Array.isArray(r) ? r.map((v) => String(v)) : [];
  } catch {
    specVersions = [];
  }
  const supportsStrk20 =
    apiVersions.some(isStrk20CapableVersion) || specVersions.some(isStrk20CapableVersion);

  let chainId: string | null = null;
  try {
    chainId = (await provider.request({ type: 'wallet_requestChainId' })) as string;
  } catch {
    chainId = null;
  }

  let state: WalletApiLaneState;
  if (!connected) {
    state = 'CONNECT_WALLET';
  } else if (!chainId || BigInt(chainId) !== BigInt(SN_SEPOLIA_CHAIN_ID)) {
    state = 'WRONG_NETWORK';
  } else if (!supportsStrk20) {
    state = 'PRIVACY_WALLET_REQUIRED';
  } else {
    state = 'READY';
  }

  return {
    connected,
    walletName: wallet?.walletName,
    hasProvider: true,
    supportedWalletApiVersions: apiVersions,
    supportedSpecVersions: specVersions,
    supportsStrk20,
    chainId,
    state,
  };
}

// ─── Private balances ─────────────────────────────────────────────────────────

/**
 * Query the wallet's current Wallet API permissions (official `wallet_getPermissions`).
 * The standard only exposes "accounts"; Ready's "share private balances" consent is
 * wallet-internal and is tracked by the app's session `WalletBalancePermission` state.
 */
export async function getWalletPermissions(wallet: any): Promise<string[]> {
  const provider = requireReadyProvider(wallet);
  try {
    const res = (await provider.request({ type: 'wallet_getPermissions' })) as unknown;
    return Array.isArray(res) ? res.map(String) : [];
  } catch {
    return [];
  }
}

/** Query the user's private balances from the privacy wallet (authoritative). */
export async function getPrivateBalances(
  wallet: any,
  tokens: string[],
): Promise<PrivateBalanceEntry[]> {
  const provider = requireReadyProvider(wallet);
  const res = (await provider.request({
    type: 'wallet_strk20Balances',
    params: { tokens },
  })) as unknown;
  const entries = Array.isArray(res) ? res : [];
  return entries
    .map((e: any) => ({
      token: String(e.token ?? ''),
      balance: e.balance !== undefined ? BigInt(e.balance) : 0n,
    }))
    .filter((e) => e.token !== '');
}

// ─── Actions (Wallet API owns proving + submission) ───────────────────────────

/** Shield: deposit a supported public asset into the privacy pool as a private note. */
export async function shield(
  wallet: any,
  token: string,
  amountBase: bigint,
): Promise<WalletActionReceipt> {
  const provider = requireReadyProvider(wallet);
  return invokeStrk20(wallet, provider, [
    { type: 'deposit', token, amount: toHexFelt(amountBase) },
  ]);
}

/** Private transfer: shielded note → shielded note to a registered recipient. */
export async function privateTransfer(
  wallet: any,
  token: string,
  amountBase: bigint,
  recipient: string,
): Promise<WalletActionReceipt> {
  const provider = requireReadyProvider(wallet);
  return invokeStrk20(wallet, provider, [
    { type: 'transfer', token, amount: toHexFelt(amountBase), recipient },
  ]);
}

/** Unshield: withdraw private note back to a public recipient address. */
export async function unshield(
  wallet: any,
  token: string,
  amountBase: bigint,
  recipient: string,
): Promise<WalletActionReceipt> {
  const provider = requireReadyProvider(wallet);
  return invokeStrk20(wallet, provider, [
    { type: 'withdraw', token, amount: toHexFelt(amountBase), recipient },
  ]);
}

async function invokeStrk20(
  wallet: any,
  provider: WalletApiProvider,
  actions: unknown[],
): Promise<WalletActionReceipt> {
  const res = (await provider.request({
    type: 'wallet_strk20InvokeTransaction',
    params: { actions },
  })) as unknown;
  const tx = res as { transaction_hash?: string };
  const transactionHash = tx?.transaction_hash ?? '';
  if (!transactionHash) {
    throw new Error('Wallet returned no transaction hash for the STRK20 action.');
  }
  return { transactionHash };
}

function requireReadyProvider(wallet: any): WalletApiProvider {
  const provider = resolveWalletApiProvider(wallet);
  if (!provider) {
    throw new Error('A privacy-enabled Starknet wallet is required for STRK20.');
  }
  return provider;
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export type Strk20ReconcileStatus = 'CONFIRMED' | 'PENDING' | 'REVERTED' | 'UNKNOWN';

/**
 * Wait for a STRK20 transaction to reach a terminal on-chain state using the public
 * Starknet RPC (the wallet lane submits on-chain like any other tx). Proof generation
 * happens in the wallet BEFORE submission, so once a hash is returned the tx is a normal
 * Starknet tx. A ceiling prevents an unbounded await; a timeout is reported as PENDING
 * (never falsely "CONFIRMED").
 */
export async function waitForStrk20Confirmation(
  transactionHash: string,
  rpcUrl?: string,
  timeoutMs = 120_000,
): Promise<Strk20ReconcileStatus> {
  const { RpcProvider } = await import('starknet');
  const provider = new RpcProvider({
    nodeUrl: rpcUrl || 'https://api.cartridge.gg/x/starknet/sepolia',
  });
  const waitPromise = provider.waitForTransaction(transactionHash, { retryInterval: 4000 });
  const timeoutPromise = new Promise<Strk20ReconcileStatus>((resolve) =>
    setTimeout(() => resolve('PENDING'), timeoutMs),
  );
  const result = await Promise.race([waitPromise, timeoutPromise]);
  if (result === 'PENDING') return 'PENDING';
  try {
    const receipt: any = result;
    const exec = receipt?.execution_status ?? receipt?.status ?? 'UNKNOWN';
    if (exec === 'REVERTED' || exec === 'REJECTED') return 'REVERTED';
    if (exec === 'SUCCEEDED' || exec === 'ACCEPTED_ON_L2' || exec === 'ACCEPTED_ON_L1') {
      return 'CONFIRMED';
    }
    return 'PENDING';
  } catch {
    return 'UNKNOWN';
  }
}

// ─── Error translation ────────────────────────────────────────────────────────

export interface TranslatedWalletError {
  code?: number;
  userMessage: string;
}

/**
 * Map Wallet API / JSON-RPC errors to honest UX messages.
 * Codes from starknet-specs wallet-api errors (NOT_REGISTERED=118, …).
 *
 * When `opts.asset` is provided and the wallet rejects the payload with an invalid
 * payload / unknown error, the generic lane fails closed with the explicit
 * asset-unsupported message — the app constructs well-formed requests, so a rejection
 * of a configured token is surfaced as an unsupported asset (never silently
 * substituted with another token).
 *
 * When `opts.recipient` is true (private-send context), recipient-readiness failures —
 * the recipient never enabled STRK20 private receiving — are translated to the honest
 * recipient message instead of a raw protocol error. This is a protocol requirement:
 * a private note can only be created for a recipient whose viewing key is registered.
 */
export function translateWalletError(
  err: unknown,
  opts?: { asset?: string; recipient?: boolean },
): TranslatedWalletError {
  const anyErr = err as { code?: number; message?: string; data?: unknown };
  const code = typeof anyErr?.code === 'number' ? anyErr.code : undefined;

  // Recipient-readiness: only meaningful when sending privately to another address.
  if (opts?.recipient && isRecipientReadinessError(err)) {
    return { code, userMessage: PRIVATE_RECEIVING_RECIPIENT_MESSAGE };
  }

  switch (code) {
    case 118:
      return {
        code,
        userMessage:
          'Your wallet is not registered for private STRK20 yet. Complete privacy setup in your wallet and try again.',
      };
    case 119:
      return {
        code,
        userMessage: 'Insufficient private balance. Shield more funds before sending.',
      };
    case 120:
      return {
        code,
        userMessage:
          'The wallet rejected this private transaction because the requested action could reveal private state.',
      };
    case 113:
      return { code, userMessage: 'You rejected the operation in your wallet.' };
    case 114:
      return opts?.asset
        ? {
            code,
            userMessage: `This asset (${opts.asset}) is not supported by the connected STRK20 privacy wallet/pool.`,
          }
        : { code, userMessage: 'The wallet rejected the request payload as invalid.' };
    case 162:
      return {
        code,
        userMessage:
          'This wallet does not support the required STRK20 Wallet API version. Update your privacy wallet.',
      };
    default:
      return {
        code,
        userMessage:
          opts?.asset && (code === 163 || code === undefined)
            ? `This asset (${opts.asset}) is not supported by the connected STRK20 privacy wallet/pool.`
            : anyErr?.message || 'Unknown wallet error.',
      };
  }
}

export const strk20WalletApiService = {
  resolveWalletApiProvider,
  getWalletApiStatus,
  getWalletPermissions,
  getPrivateBalances,
  getPrivateReceivingRequirement,
  enablePrivateReceiving,
  switchWalletNetwork,
  isRecipientReadinessError,
  isAccountFinalizingError,
  shield,
  privateTransfer,
  unshield,
  waitForStrk20Confirmation,
  translateWalletError,
};

// ─── Private-receiving onboarding (LANE A: Wallet API) ────────────────────────
//
// PROTOCOL FACTS (verified against the current spec + wallet-side SDK source):
//
//  1. The Wallet API exposes NO dapp-facing registration / channel-setup RPC.
//     STRK20_ACTION is exactly `deposit | withdraw | transfer | invoke`
//     (wallet_rpc.json, v0.10.3/0.10.4). There is no `wallet_register...` or
//     `wallet_setupChannel...` in the spec or in starknet.js WalletAccountV6.
//
//  2. Registration is TRANSPARENT in the wallet. The wallet-side prover that backs
//     `wallet_strk20InvokeTransaction` (starknet-privacy `client/src/strk20-prover.ts`,
//     CorePrivateTransfersProver.prove) runs every action with:
//         autoRegister: true, autoSetup: true, autoSelectNotes: "naive",
//         autoDiscover: { channels: "refresh", notes: "refresh" }
//     So the first time a user submits ANY real STRK20 action, the wallet itself adds
//     the SetViewingKey (registration) + OpenChannel(self) + token subchannel actions
//     to the same transaction. Registration is one-time and immutable per the protocol
//     ("viewing keys are registered once and treated as immutable").
//
//  3. The ONLY authoritative, protocol-derived readiness signal a LANE A dapp has is
//     `wallet_strk20Balances`, which returns NOT_REGISTERED (118) while the user is
//     unregistered. We never guess from error strings for readiness, and we never write
//     any local "registered" flag.
//
//  4. `discoverRequirement(recipient, token)` (Register/SetupChannel/SetupToken/Ready)
//     is the SDK-lane readiness mechanism. It requires the user's viewing key and an
//     indexer, so a LANE A dapp MUST NOT use it (privacy rule: the dapp never handles
//     viewing keys). It remains authoritative for LANE B (strk20SdkService).
//
//  5. Because there is no pure-registration action in the Wallet API, the closest
//     protocol-correct onboarding is a real `wallet_strk20InvokeTransaction` deposit:
//     the wallet transparently registers + sets up + deposits the first note in the SAME
//     transaction. This is implemented below, surfaced with real step/state transitions
//     and the real transaction hash. No fake state is ever created.

export type PrivateReceivingRequirement =
  | 'CONNECT_WALLET'
  | 'UNSUPPORTED'
  | 'WRONG_NETWORK'
  | 'NEEDS_REGISTRATION'
  | 'READY'
  | 'UNKNOWN';

export type PrivateReceivingEnableStatus =
  | 'READY' // already registered — no transaction sent
  | 'SUBMITTED' // registration/setup transaction submitted (real hash), awaiting confirmation
  | 'CONFIRMED' // transaction confirmed AND re-probe verified READY (or wallet read is unavailable)
  | 'UNSUPPORTED'
  | 'WRONG_NETWORK'
  | 'USER_REJECTED'
  | 'ACCOUNT_FINALIZING'
  | 'FAILED';

export interface PrivateReceivingEnableResult {
  status: PrivateReceivingEnableStatus;
  transactionHash?: string;
  message?: string;
}

/**
 * Progress callback fired by `enablePrivateReceiving` so the UI can render each real
 * protocol phase. `WALLET_APPROVAL` means the Ready wallet itself is showing the
 * approval/proof UI — the dapp did not perform the operation on its own.
 */
export type PrivateReceivingStep =
  | 'CHECKING'
  | 'WALLET_APPROVAL'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'CONFIRMED';

export type PrivateReceivingStepCallback = (
  step: PrivateReceivingStep,
  detail?: { transactionHash?: string },
) => void;

/**
 * Read the connected wallet's private-receiving requirement from protocol state.
 *
 * Only ever called on explicit user action (never during render) so the wallet's
 * private-balance consent is not spam-triggered.
 */
export async function getPrivateReceivingRequirement(
  wallet: any,
): Promise<PrivateReceivingRequirement> {
  const provider = resolveWalletApiProvider(wallet);
  if (!provider || !wallet?.isConnected) return 'CONNECT_WALLET';

  let status: WalletApiStatus;
  try {
    status = await getWalletApiStatus(wallet);
  } catch {
    return 'UNKNOWN';
  }
  if (!status.supportsStrk20) return 'UNSUPPORTED';
  if (status.chainId && BigInt(status.chainId) !== BigInt(SN_SEPOLIA_CHAIN_ID)) {
    return 'WRONG_NETWORK';
  }

  // Authoritative registration probe: wallet_strk20Balances returns NOT_REGISTERED
  // while the user is unregistered. Success => viewing key registered on-chain.
  try {
    await provider.request({ type: 'wallet_strk20Balances', params: { tokens: [] } });
    return 'READY';
  } catch (err: any) {
    if (typeof err?.code === 'number' && err.code === 118) return 'NEEDS_REGISTRATION';
    return 'UNKNOWN';
  }
}

/**
 * True when the wallet/prover is telling us the account is not sufficiently finalized
 * to prove against (the SDK documents a ~10-block finalization safety rule). This is a
 * wait-and-retry condition, not a terminal failure. Patterns are intentionally narrow
 * to avoid misclassifying other wallet errors (e.g. NOT_REGISTERED on reads).
 */
export function isAccountFinalizingError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || '').toLowerCase();
  const patterns = [
    'not finalized',
    'finaliz',
    'account not deployed',
    'account is not deployed',
    'cannot register yet',
    'cannot be registered yet',
    'not yet available',
    'stale block',
    'reorg',
    'not enough blocks',
  ];
  return patterns.some((p) => msg.includes(p));
}

/**
 * Enable STRK20 private receiving for the connected Ready address.
 *
 * Steps (LANE A — the wallet owns proving/submission):
 *  1. Read the requirement from protocol state (see getPrivateReceivingRequirement).
 *  2. If already READY → no transaction is sent.
 *  3. If NEEDS_REGISTRATION → submit a real `wallet_strk20InvokeTransaction` deposit.
 *     The wallet transparently performs registration (SetViewingKey) + self-channel +
 *     token subchannel setup + the deposit in one transaction (autoRegister/autoSetup).
 *     This is the documented registration path for LANE A.
 *  4. Wait for on-chain acceptance; then re-probe readiness. CONFIRMED is only returned
 *     after the wallet/protocol confirms the transaction (never from the hash alone).
 *
 * @param opts.token      STRK20 token address the first note is deposited against.
 * @param opts.amountBase Deposit amount in the token's smallest unit (> 0).
 * @param opts.reconcile  Optional on-chain reconcile function (injectable for tests);
 *                        defaults to waitForStrk20Confirmation against the public RPC.
 */
export async function enablePrivateReceiving(
  wallet: any,
  opts: { token: string; amountBase: bigint; reconcile?: (hash: string) => Promise<Strk20ReconcileStatus> },
  onStep?: PrivateReceivingStepCallback,
): Promise<PrivateReceivingEnableResult> {
  onStep?.('CHECKING');
  const requirement = await getPrivateReceivingRequirement(wallet);
  switch (requirement) {
    case 'CONNECT_WALLET':
      return { status: 'FAILED', message: 'Connect your Ready Wallet first.' };
    case 'UNSUPPORTED':
      return {
        status: 'UNSUPPORTED',
        message:
          "STRK20 privacy isn't supported by this wallet yet. Use Ready X to enable private transfers.",
      };
    case 'WRONG_NETWORK':
      return {
        status: 'WRONG_NETWORK',
        message: 'Private STRK20 works on Starknet Sepolia. Switch your wallet network and try again.',
      };
    case 'READY':
      return {
        status: 'READY',
        message: 'Private receiving is already enabled for this Ready address.',
      };
    case 'UNKNOWN':
      return {
        status: 'FAILED',
        message: 'Could not determine private-receiving status. Try again.',
      };
    case 'NEEDS_REGISTRATION':
      break;
  }

  if (!opts?.token || opts.amountBase <= 0n) {
    return {
      status: 'FAILED',
      message: 'A token and a shield amount greater than zero are required to enable private receiving.',
    };
  }

  const provider = requireReadyProvider(wallet);
  let receipt: WalletActionReceipt;
  try {
    onStep?.('WALLET_APPROVAL');
    receipt = await invokeStrk20(wallet, provider, [
      { type: 'deposit', token: opts.token, amount: toHexFelt(opts.amountBase) },
    ]);
  } catch (err: any) {
    const code = typeof err?.code === 'number' ? err.code : undefined;
    if (code === 113) {
      return {
        status: 'USER_REJECTED',
        message: 'You declined the STRK20 privacy setup in Ready. No transaction was sent.',
      };
    }
    // NOT_REGISTERED on an INVOKE (vs. the balances read) means the wallet could not
    // transparently register — per the spec, registration is what should happen here.
    // The documented cause is insufficient block finality for the account/prover.
    if (code === 118 || isAccountFinalizingError(err)) {
      return {
        status: 'ACCOUNT_FINALIZING',
        message:
          'Your account is still finalizing. Wait a few blocks (~10 blocks), then try again.',
      };
    }
    return { status: 'FAILED', message: translateWalletError(err).userMessage };
  }

  // Reconcile with the real chain; never claim enabled from a hash alone.
  const reconcile =
    opts.reconcile ?? ((hash: string) => waitForStrk20Confirmation(hash));
  onStep?.('SUBMITTED', { transactionHash: receipt.transactionHash });
  onStep?.('CONFIRMING', { transactionHash: receipt.transactionHash });
  const reconcileResult = await reconcile(receipt.transactionHash);
  if (reconcileResult === 'CONFIRMED') {
    const after = await getPrivateReceivingRequirement(wallet);
    if (after === 'READY') {
      onStep?.('CONFIRMED', { transactionHash: receipt.transactionHash });
      return {
        status: 'CONFIRMED',
        transactionHash: receipt.transactionHash,
        message: 'Private receiving is enabled for this Ready address.',
      };
    }
    if (after === 'UNKNOWN') {
      onStep?.('CONFIRMED', { transactionHash: receipt.transactionHash });
      return {
        status: 'CONFIRMED',
        transactionHash: receipt.transactionHash,
        message:
          'Registration transaction confirmed. Re-check shortly to confirm receiving state.',
      };
    }
    return {
      status: 'FAILED',
      transactionHash: receipt.transactionHash,
      message:
        'Registration was submitted but could not yet be verified as ready. Re-check shortly.',
    };
  }
  if (reconcileResult === 'REVERTED') {
    return {
      status: 'FAILED',
      transactionHash: receipt.transactionHash,
      message: 'The privacy-setup transaction reverted on-chain.',
    };
  }
  return {
    status: 'SUBMITTED',
    transactionHash: receipt.transactionHash,
    message: 'Privacy setup submitted — awaiting confirmation.',
  };
}

// ─── Network switching (official wallet_requestChainId / wallet_switchStarknetChain) ──

export type WalletNetworkSwitchStatus =
  | 'SWITCHED' // wallet switched; returns the authoritative new chainId
  | 'ALREADY_ON_CHAIN'
  | 'USER_REJECTED' // user declined in the wallet prompt
  | 'CHAIN_UNSUPPORTED' // wallet can't add/switch to this chain (UNLISTED_NETWORK/CHAIN_ID_NOT_SUPPORTED)
  | 'NOT_CONNECTED'
  | 'ERROR';

export interface WalletNetworkSwitchResult {
  status: WalletNetworkSwitchStatus;
  chainId?: string;
  message?: string;
}

/**
 * Ask the connected wallet to switch to `targetChainIdHex` via the official
 * `wallet_switchStarknetChain` Wallet API method. This surfaces the wallet's own
 * network-switch prompt (approval UI) to the user.
 *
 * Re-queries `wallet_requestChainId` after a successful switch so the caller can sync
 * app state to the wallet's authoritative chain (the wallet's synchronous `chainId`
 * property can be stale right after a switch).
 */
export async function switchWalletNetwork(
  wallet: any,
  targetChainIdHex: string,
): Promise<WalletNetworkSwitchResult> {
  const provider = resolveWalletApiProvider(wallet);
  if (!provider || !wallet?.isConnected) {
    return { status: 'NOT_CONNECTED', message: 'Connect a wallet first.' };
  }

  let current: string | null = null;
  try {
    current = String(await provider.request({ type: 'wallet_requestChainId' }));
  } catch {
    current = null;
  }
  if (current && BigInt(current) === BigInt(targetChainIdHex)) {
    return { status: 'ALREADY_ON_CHAIN', chainId: current, message: 'Wallet is already on this network.' };
  }

  try {
    await provider.request({
      type: 'wallet_switchStarknetChain',
      params: { chainId: targetChainIdHex },
    });
  } catch (err: any) {
    const code = typeof err?.code === 'number' ? err.code : undefined;
    if (code === 113) {
      return { status: 'USER_REJECTED', message: 'You declined the network switch in your wallet.' };
    }
    if (code === 117 || code === 112) {
      return {
        status: 'CHAIN_UNSUPPORTED',
        message: 'Your wallet does not support this network. Add it in your wallet first.',
      };
    }
    return { status: 'ERROR', message: err?.message || 'Failed to switch network in the wallet.' };
  }

  let newChain: string | null = null;
  try {
    newChain = String(await provider.request({ type: 'wallet_requestChainId' }));
  } catch {
    newChain = null;
  }
  return {
    status: 'SWITCHED',
    chainId: newChain ?? targetChainIdHex,
    message: 'Network switched in the wallet.',
  };
}

// ─── Recipient-readiness error translation ────────────────────────────────────

/**
 * True when a Wallet API failure means "the RECIPIENT hasn't enabled STRK20 private
 * receiving yet" (e.g. "Missing channel context"), as opposed to a sender-side problem.
 *
 * The Wallet API has no recipient-registration error code, so this detects the wallet's
 * surfaced message. This is a protocol requirement, not a UI bug: a private note can only
 * be created for a recipient whose public viewing key is registered in the pool.
 */
export function isRecipientReadinessError(err: unknown): boolean {
  const anyErr = err as { code?: number; message?: string; data?: unknown };
  const message = String(anyErr?.message || '');
  const lower = message.toLowerCase();
  const patterns = [
    'missing channel context',
    'channel context',
    'no channel',
    'channel is not',
    'channel does not',
    'recipient is not registered',
    'recipient has not registered',
    'recipient has not been registered',
    'recipient not registered',
    'recipient has no',
    'recipient has not enabled',
    'recipient.*private receiving',
    'recipient.*setup',
    'register the recipient',
    'setup the recipient',
    'setup required',
    'setup requirement',
    'privacy not enabled',
    'private receiving not enabled',
    'not enabled for private',
    'cannot create note',
    'cannot construct note',
  ];
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(lower);
    } catch {
      return lower.includes(p);
    }
  });
}

export const PRIVATE_RECEIVING_RECIPIENT_MESSAGE =
  "This recipient hasn't enabled STRK20 private receiving yet. Ask them to enable private receiving in a supported privacy wallet (e.g. Ready).";