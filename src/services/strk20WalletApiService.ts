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
  checkPrivateReceivingStatus,
  enablePrivateReceiving,
  isRecipientReadinessError,
  shield,
  privateTransfer,
  unshield,
  waitForStrk20Confirmation,
  translateWalletError,
};

// ─── Private-receiving onboarding (wallet-owned) ──────────────────────────────

export type PrivateReceivingStatus = 'UNKNOWN' | 'ENABLED' | 'NOT_ENABLED' | 'UNSUPPORTED';

export type EnablePrivateReceivingResult = {
  status: 'ALREADY_ENABLED' | 'NEEDS_FIRST_SHIELD' | 'UNSUPPORTED' | 'ERROR';
  message: string;
};

/**
 * Check whether the connected wallet is registered for STRK20 private receiving.
 *
 * Registration ("Enable private receiving") is wallet-owned: the wallet sets a viewing
 * key on-chain. The Wallet API exposes no standalone "register recipient" RPC — the
 * wallet registers the user transparently on their first STRK20 action (per the spec:
 * "Registration into the pool is transparent"). We therefore probe registration with a
 * read (wallet_strk20Balances) and translate the official NOT_REGISTERED (118) code.
 *
 * This is only ever called on explicit user action (never on render) so the wallet's
 * private-balance consent prompt is not spam-triggered.
 */
export async function checkPrivateReceivingStatus(wallet: any): Promise<PrivateReceivingStatus> {
  const provider = resolveWalletApiProvider(wallet);
  if (!provider || !wallet?.isConnected) return 'UNKNOWN';

  // Capability gate: only a STRK20-capable Wallet API ≥ 0.10 wallet can onboard.
  try {
    const status = await getWalletApiStatus(wallet);
    if (!status.supportsStrk20) return 'UNSUPPORTED';
  } catch {
    return 'UNKNOWN';
  }

  // Probe registration. Success => viewing key registered. NOT_REGISTERED => not onboarded.
  try {
    await provider.request({ type: 'wallet_strk20Balances', params: { tokens: [] } });
    return 'ENABLED';
  } catch (err: any) {
    if (typeof err?.code === 'number' && err.code === 118) return 'NOT_ENABLED';
    return 'UNKNOWN';
  }
}

/**
 * Trigger the connected wallet's STRK20 onboarding so the user can receive private
 * transfers. Honest by construction:
 *  - A non-STRK20 wallet is reported as UNSUPPORTED (never faked into the private lane).
 *  - A registered wallet is ALREADY_ENABLED.
 *  - An unregistered wallet reports NEEDS_FIRST_SHIELD: the Wallet API has no standalone
 *    register RPC, so the wallet completes registration on the user's first Shield
 *    (a deposit). We never fabricate a "registered recipient" or fake a local channel.
 */
export async function enablePrivateReceiving(wallet: any): Promise<EnablePrivateReceivingResult> {
  const current = await checkPrivateReceivingStatus(wallet);
  if (current === 'UNSUPPORTED') {
    return {
      status: 'UNSUPPORTED',
      message:
        "STRK20 privacy isn't supported by this wallet yet. Use Ready X to enable private transfers.",
    };
  }
  if (current === 'ENABLED') {
    return {
      status: 'ALREADY_ENABLED',
      message: 'Private receiving is already enabled for this wallet.',
    };
  }
  if (current === 'NOT_ENABLED') {
    return {
      status: 'NEEDS_FIRST_SHIELD',
      message:
        'Private receiving is enabled automatically the first time you Shield. Shield any amount to complete onboarding.',
    };
  }
  return {
    status: 'ERROR',
    message:
      "Could not determine private-receiving status. Make sure your wallet is connected on Starknet Sepolia and try again.",
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