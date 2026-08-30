/**
 * @file src/services/privateLaunchService.ts
 * @description UMBRA LAUNCH PRIVATE execution — the STRK20 invoke-anonymizer lane.
 *
 * A private trade is a single STRK20 transaction whose wallet-side prover (Ready) assembles:
 *   1. withdraw  input token  → PrivateCurveExecutor   (pool pays the executor)
 *   2. transfer  output token → "OPEN" note for the user (pool creates an open note)
 *   3. invoke    executor     → calldata includes the resolved open-note id
 *
 * The executor then spends the withdrawn input on the canonical public BondingCurve and
 * returns one `OpenNoteDeposit`; the pool pulls the output and fills the open note. The
 * public market state moves exactly like a public trade — the user's wallet is only linked
 * through the STRK20 proof, and the dapp never touches viewing keys or notes.
 *
 * The wallet resolves the `${openNoteIds[0]}` placeholder during proof assembly
 * (starknet-specs wallet-api v0.10.4-rc.1 `STRK20_INVOKE_ACTION`), so the dapp does not
 * need to compute note ids.
 */

import { strk20WalletApiService } from '@/services/strk20WalletApiService';

export const CURVE_OP = {
  BUY: 0,
  SELL: 1,
} as const;

export type Strk20Action =
  | { type: 'deposit'; token: string; amount: string }
  | { type: 'withdraw'; token: string; amount: string; recipient: string }
  | { type: 'transfer'; token: string; amount: string | 'OPEN'; recipient: string }
  | { type: 'invoke'; contract: string; calldata: (string | number)[] };

export interface PrivateTradePlan {
  operation: number;
  /** Input token the pool withdraws to the executor (base for buy, memecoin for sell). */
  inputToken: string;
  /** Output token deposited to the open note (memecoin for buy, base for sell). */
  outputToken: string;
  /** Input amount in the smallest unit. */
  amount: string;
  /** PrivateCurveExecutor address. */
  executor: string;
  /** The user's own address (open-note recipient). */
  userAddress: string;
}

function hexFelt(value: string | bigint): string {
  if (typeof value === 'bigint') return '0x' + value.toString(16);
  return value.startsWith('0x') || value.startsWith('0X') ? value : '0x' + BigInt(value).toString(16);
}

/**
 * Build the ordered STRK20 actions for a PRIVATE BUY.
 *
 *  withdraw(STRK → executor) · transfer(HAMSTR OPEN → user) · invoke(executor, buy)
 */
export function buildPrivateBuyActions(plan: PrivateTradePlan): Strk20Action[] {
  return [
    {
      type: 'withdraw',
      token: hexFelt(plan.inputToken),
      amount: hexFelt(plan.amount),
      recipient: plan.executor,
    },
    {
      type: 'transfer',
      token: hexFelt(plan.outputToken),
      amount: 'OPEN',
      recipient: plan.userAddress,
    },
    {
      type: 'invoke',
      contract: plan.executor,
      calldata: [
        CURVE_OP.BUY,
        hexFelt(plan.inputToken),
        hexFelt(plan.amount),
        '${openNoteIds[0]}',
      ],
    },
  ];
}

/**
 * Build the ordered STRK20 actions for a PRIVATE SELL.
 *
 *  withdraw(HAMSTR → executor) · transfer(STRK OPEN → user) · invoke(executor, sell)
 */
export function buildPrivateSellActions(plan: PrivateTradePlan): Strk20Action[] {
  return [
    {
      type: 'withdraw',
      token: hexFelt(plan.inputToken),
      amount: hexFelt(plan.amount),
      recipient: plan.executor,
    },
    {
      type: 'transfer',
      token: hexFelt(plan.outputToken),
      amount: 'OPEN',
      recipient: plan.userAddress,
    },
    {
      type: 'invoke',
      contract: plan.executor,
      calldata: [
        CURVE_OP.SELL,
        hexFelt(plan.inputToken),
        hexFelt(plan.amount),
        '${openNoteIds[0]}',
      ],
    },
  ];
}

export interface PreparedStrk20Trade {
  call: { contract_address: string; entry_point: string; calldata: string[] };
  proof: { data: string; output: string[]; proof_facts: string[] };
}

/**
 * Ask the connected STRK20 wallet (Ready) to prepare the private trade: it assembles the
 * proof invocation (resolving ${openNoteIds[0]}), generates the SNIP-36 proof, and returns
 * the call + proof for the dapp to submit. No viewing keys or notes are handled by the dapp.
 */
export async function preparePrivateTrade(
  wallet: any,
  actions: Strk20Action[],
  simulate = false,
): Promise<PreparedStrk20Trade> {
  const provider = resolveWalletProvider(wallet);
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('A STRK20-capable wallet (Ready) is required for private trades.');
  }
  const res = (await provider.request({
    type: 'wallet_strk20PrepareInvoke',
    params: { actions, simulate },
  })) as any;
  const call = res?.call;
  const proof = res?.proof;
  if (!call) {
    throw new Error('The wallet did not return a call for the private trade.');
  }
  return {
    call: {
      contract_address: call.contract_address ?? call.contractAddress,
      entry_point: call.entry_point ?? call.entrypoint ?? 'apply_actions',
      calldata: call.calldata ?? [],
    },
    proof: {
      data: proof?.data ?? '',
      output: proof?.output ?? [],
      proof_facts: proof?.proof_facts ?? proof?.proofFacts ?? [],
    },
  };
}

/**
 * Submit a prepared STRK20 call + proof on-chain via `wallet_addInvokeTransaction`.
 * Returns the transaction hash.
 */
export async function submitPreparedTrade(
  wallet: any,
  prepared: PreparedStrk20Trade,
): Promise<{ transactionHash: string }> {
  const provider = resolveWalletProvider(wallet);
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('A STRK20-capable wallet (Ready) is required to submit private trades.');
  }
  const res = (await provider.request({
    type: 'wallet_addInvokeTransaction',
    params: {
      invoke_transaction: [
        {
          contract_address: prepared.call.contract_address,
          entry_point: prepared.call.entry_point,
          calldata: prepared.call.calldata,
        },
      ],
      proof: {
        data: prepared.proof.data,
        output: prepared.proof.output,
        proof_facts: prepared.proof.proof_facts,
      },
    },
  })) as any;
  const transactionHash = res?.transaction_hash ?? res?.transactionHash ?? '';
  if (!transactionHash) throw new Error('Private trade submitted but no transaction hash returned.');
  return { transactionHash };
}

/**
 * One-shot: prepare + submit a private trade. `simulate=true` builds the call without a
 * proof for fee estimation / UI preview (not submittable on-chain).
 */
export async function executePrivateTrade(
  wallet: any,
  actions: Strk20Action[],
  opts?: { simulate?: boolean },
): Promise<{ transactionHash: string; prepared?: PreparedStrk20Trade }> {
  const prepared = await preparePrivateTrade(wallet, actions, opts?.simulate ?? false);
  if (opts?.simulate) return { transactionHash: '', prepared };
  const { transactionHash } = await submitPreparedTrade(wallet, prepared);
  return { transactionHash, prepared };
}

/** Resolve the Wallet API provider from the connected wallet (same rule as the repo lane). */
export function resolveWalletProvider(wallet: any): { request: (c: any) => Promise<unknown> } | null {
  if (!wallet) return null;
  const candidates = [
    wallet.rawWallet,
    wallet.rawWallet?.provider,
    wallet.walletAccount,
    wallet.walletAccount?.provider,
    wallet.provider,
  ];
  for (const c of candidates) {
    if (c && typeof (c as any).request === 'function') return c as any;
  }
  return null;
}

export interface ShieldLaneOpts {
  /** Connected wallet (Ready lane) or merged effective wallet. */
  wallet: any;
  /** Privy context (Privy lane). */
  privy: any;
  /** True when the Privy STRK20 lane is live (authenticated + account + viewing key). */
  privyConnected: boolean;
  /** Token to shield (the launched memecoin or STRK). */
  token: string;
  /** Amount in the smallest unit. */
  amountBase: bigint;
  /** Optional recipient for unshield (defaults to the wallet address). */
  recipient?: string;
}

/**
 * Shield (make private) an arbitrary token — the launched memecoin or the STRK base — via
 * whichever STRK20 lane is connected. The token stays the SAME standard ERC20; shielding
 * moves it into a STRK20 note held by the pool. No wrapped token is ever created.
 */
export async function shieldLaunchToken(opts: ShieldLaneOpts): Promise<{ transactionHash: string }> {
  if (opts.privyConnected) {
    const res = await opts.privy.shield(opts.token, opts.amountBase);
    return { transactionHash: res.transactionHash };
  }
  const res = await strk20WalletApiService.shield(opts.wallet, opts.token, opts.amountBase);
  return { transactionHash: res.transactionHash };
}

/**
 * Unshield (make public) a shielded balance back to the user's public wallet. The output is
 * the same standard ERC20 — private balances are STRK20 notes of the real token, never a
 * separate token.
 */
export async function unshieldLaunchToken(
  opts: ShieldLaneOpts,
): Promise<{ transactionHash: string }> {
  const recipient = opts.recipient ?? opts.wallet.address ?? '';
  if (opts.privyConnected) {
    const res = await opts.privy.unshield(opts.token, opts.amountBase, recipient);
    return { transactionHash: res.transactionHash };
  }
  const res = await strk20WalletApiService.unshield(opts.wallet, opts.token, opts.amountBase, recipient);
  return { transactionHash: res.transactionHash };
}