import { hash } from "starknet";
import type { Strk20Adapter, Strk20User, ShadowCallLike } from "./Strk20Adapter";
import { Strk20Paymaster, type PaymasterBuild } from "./paymaster";

/**
 * Privacy Core — REAL STRK20 shadow-account execution (RC5 `shadowAccounts()`).
 *
 * This is the first REAL shadow-account application adapter on the generic `Strk20Adapter` (it
 * replaces the earlier `privacy_invoke` prototype, which was NOT a shadow account). The flow:
 *
 *   MASTER WALLET (Wallet Core authority)
 *     → WalletPrivacySession (viewing key)
 *     → STRK20 private balance (mature shielded notes)
 *     → shadowAccounts(appName)            — SDK RC5 builder
 *     → commitment(nonce)                  — deterministic shadow identity
 *     → shadow address (counterfactual, anonymizer-derived)
 *     → withdraw private STRK → shadow address
 *     → shadow.invoke(nonce, { calls })    — the anonymizer deploys/uses the shadow account and
 *                                            executes the application `calls` FROM it
 *     → private paymaster relays the proof → OUTER tx sender ≠ root wallet
 *     → Starknet application sees the SHADOW ACCOUNT as caller
 *
 * The user's Wallet Core account signs the PROOF INVOCATION (the SDK builds it with the wallet's
 * signer — this authorizes the private-note spending). The OUTER transaction is relayed through
 * the AVNU private paymaster so the root wallet is never the on-chain tx sender.
 *
 * Security invariants preserved:
 *   - the master key stays in Wallet Core; nothing is persisted or logged;
 *   - the viewing key stays inside WalletPrivacySession;
 *   - the application only ever sees the shadow account (never the root wallet);
 *   - the shadow identity is scoped by (owner, chain, appName, nonce) — deterministic and
 *     never silently reused across wallets/networks.
 */

/** Counterfactual "primer" class the pinned Sepolia anonymizer uses in the shadow-address
 * formula: `calculateContractAddressFromHash(commitment, PRIMER, [], anonymizer)`. */
export const SHADOW_ACCOUNT_PRIMER_CLASS_HASH =
  0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300n;

/** Blocks a shielded note must predate the proving block to be spendable (protocol note maturity). */
export const SHADOW_NOTE_MATURITY_BLOCKS = 10;

export interface ShadowNoteLike {
  amount: bigint;
  created?: number | string | bigint;
  open?: boolean;
  [key: string]: unknown;
}

export interface ShadowAccountInvokeParams {
  /** Application scope shared by the shadow identities created by this call (Cairo short string). */
  appName: string;
  /** Identity nonce — selects the deterministic shadow identity/address. */
  nonce: bigint;
  /** STRK20 token funding the shadow account. */
  token: string;
  /** Amount (base units) withdrawn privately into the shadow account before the calls run. */
  amount: bigint;
  /** Application calls the shadow account executes (validated by the executor). */
  calls: ShadowCallLike[];
  /** Surplus/remainder recipient (defaults to the user's own wallet). */
  destination?: string;
  /** Collect any token left in the shadow account back into a note for the root (default false). */
  collectRemainder?: boolean;
}

export interface ShadowAccountInvokeResult {
  transactionHash: string;
  commitment: string;
  shadowAddress: string;
  nonce: bigint;
}

export interface ShadowAccountInvokeOptions {
  /** Private-paymaster relay (defaults to the pinned Sepolia AVNU paymaster). */
  paymaster?: Strk20Paymaster;
  poolAddress?: string;
  /** Note maturity (blocks) relative to the proving block. Default 10. */
  maturityBlocks?: number;
}

export function normalizeAddress(value: string | bigint | number): string {
  return "0x" + BigInt(value).toString(16);
}

export function sameAddress(left: string | bigint | number, right: string | bigint | number): boolean {
  return BigInt(left) === BigInt(right);
}

/** Counterfactual shadow-account address for a commitment, per the pinned anonymizer formula. */
export function shadowAddressFromCommitment(commitment: bigint, anonymizerAddress: bigint): string {
  return normalizeAddress(
    hash.calculateContractAddressFromHash(
      commitment,
      SHADOW_ACCOUNT_PRIMER_CLASS_HASH,
      [],
      anonymizerAddress,
    ),
  );
}

/** Mature-note selection: only notes that predate `provingBlock` by `maturityBlocks` are spendable. */
export interface NoteSelection {
  notes: ShadowNoteLike[];
  selectedAmount: bigint;
  matureBalance: bigint;
  privateBalance: bigint;
}

export function selectMatureNotes(
  notes: ShadowNoteLike[],
  required: bigint,
  provingBlock: number,
  maturityBlocks: number,
): NoteSelection {
  const privateBalance = notes.reduce((sum, note) => sum + BigInt(note.amount ?? 0n), 0n);
  const mature = notes
    .filter((note) => {
      if (note.open || note.created === undefined || note.created === null) return false;
      return Number(note.created) + maturityBlocks <= provingBlock;
    })
    .sort((left, right) => {
      const a = BigInt(left.amount ?? 0n);
      const b = BigInt(right.amount ?? 0n);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const matureBalance = mature.reduce((sum, note) => sum + BigInt(note.amount ?? 0n), 0n);
  const selected: ShadowNoteLike[] = [];
  let selectedAmount = 0n;
  for (const note of mature) {
    selected.push(note);
    selectedAmount += BigInt(note.amount ?? 0n);
    if (selectedAmount >= required) break;
  }
  if (selectedAmount < required) {
    throw new Error(
      `Not enough mature shielded STRK. Need ${required}, mature ${matureBalance}, total ${privateBalance}. ` +
        `Shield first or wait for note maturity.`,
    );
  }
  return { notes: selected, selectedAmount, matureBalance, privateBalance };
}

let openNoteSymbol: unknown = null;

/** The SDK's `Open` unique symbol — used as the transfer amount to create an open note. */
async function loadOpenNoteSymbol(): Promise<unknown> {
  if (openNoteSymbol) return openNoteSymbol;
  const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as unknown as { Open?: unknown };
  openNoteSymbol = mod.Open;
  return openNoteSymbol;
}

/**
 * Execute a REAL shadow-account invocation: private STRK → shadow account → one application call.
 * The proof is relayed through the private paymaster so the outer tx sender is NOT the root wallet.
 */
export async function shadowAccountInvoke(
  adapter: Strk20Adapter,
  user: Strk20User,
  params: ShadowAccountInvokeParams,
  options: ShadowAccountInvokeOptions = {},
): Promise<ShadowAccountInvokeResult> {
  const root = params.destination?.trim() ? params.destination : user.address;
  const anonymizer = adapter.shadowAccountAnonymizerAddress;
  if (!anonymizer) {
    throw new Error("shadowAccounts requires shadowAccountAnonymizerAddress in the STRK20 adapter config.");
  }
  const poolAddress = options.poolAddress ?? adapter.poolContractAddress;
  const maturityBlocks = options.maturityBlocks ?? SHADOW_NOTE_MATURITY_BLOCKS;

  const provingBlock = await adapter.getSafeProvingBlock(user);
  const transfers = await adapter.getTransfers(user);

  // 1. Deterministic shadow identity: commitment(nonce) → shadow address.
  const shadow = transfers.build({}).shadowAccounts(params.appName);
  const commitment = await shadow.commitment(params.nonce);
  const shadowAddress = await shadowAddressFromCommitment(commitment, BigInt(anonymizer));

  // 2. Private-paymaster relay terms (fee is a private-note withdrawal added to the proof actions).
  const paymaster = options.paymaster ?? new Strk20Paymaster();
  const terms: PaymasterBuild = await paymaster.build(poolAddress, params.token);
  const fee = terms.fee;
  const required = params.amount + (fee?.amount ?? 0n);

  // 3. Discover + select MATURE shielded notes covering the funding + relay fee.
  const discovered = await transfers.discoverNotes({
    tokens: [BigInt(params.token)],
    blockIdentifier: provingBlock,
  });
  const selection = selectMatureNotes(
    discovered.notes.get(BigInt(params.token)) ?? [],
    required,
    provingBlock,
    maturityBlocks,
  );

  // 4. Build + prove the shadow invocation (the wallet's signer signs the PROOF INVOCATION).
  const open = params.collectRemainder ? await loadOpenNoteSymbol() : undefined;
  const result = await adapter.buildAndProve(user, (t) => {
    const builder = t.build({ autoDiscover: { channels: "refresh" } }).surplusTo(root, false);
    builder.with(params.token, (token) => {
      token.inputs(...selection.notes);
      if (params.amount > 0n) token.withdraw({ recipient: shadowAddress, amount: params.amount });
      if (fee && fee.amount > 0n) token.withdraw({ recipient: fee.recipient, amount: fee.amount });
      if (open !== undefined) token.transfer({ recipient: root, amount: open });
    });
    builder.shadowAccounts(params.appName).invoke(params.nonce, {
      calls: params.calls,
      collectPolicy: { type: "all" },
    });
    return builder;
  });

  // 5. Relay through the paymaster → OUTER tx sender is the relayer, never the root wallet.
  const submitted = await paymaster.execute({
    poolAddress,
    call: result.call,
    proof: result.proof?.data,
    proofFacts: result.proof?.proofFacts ?? [],
    build: terms,
  });

  return {
    transactionHash: submitted.transactionHash,
    commitment: normalizeAddress(commitment),
    shadowAddress,
    nonce: params.nonce,
  };
}