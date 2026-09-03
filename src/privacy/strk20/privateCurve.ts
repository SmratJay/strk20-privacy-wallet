import type { Strk20Adapter, Strk20ExecuteReceipt, Strk20User, BuilderLike } from "./Strk20Adapter";

/**
 * Launchpad private-curve trade — an APPLICATION adapter built on the GENERIC `Strk20Adapter`.
 *
 * This module keeps BondingCurve/PrivateCurveExecutor-specific logic OUT of the generic STRK20
 * adapter. The generic adapter only knows how to execute SDK builders; this module knows how to
 * build the launchpad's private trade action graph:
 *
 *   1. withdraw input token → executor          (pool pays the executor)
 *   2. transfer output token → OPEN note        (open-note deposit for the user)
 *   3. invoke(executor, privacy_invoke)         (executor trades on the public curve)
 *
 * The pool fills the open note from the executor's returned `OpenNoteDeposit`.
 */

let openNoteSymbol: unknown = null;

/** The SDK's `Open` unique symbol — used as `amount` to create an open note that a
 * `privacy_invoke` executor deposit will fill. Cached after first load. */
async function loadOpenNoteSymbol(): Promise<unknown> {
  if (openNoteSymbol) return openNoteSymbol;
  const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as unknown as {
    Open?: unknown;
  };
  openNoteSymbol = mod.Open;
  return openNoteSymbol;
}

/** A private trade through the launchpad's canonical PrivateCurveExecutor. `operation` is the
 * curve op (0 = BUY, 1 = SELL) matching `curve_operation` in the contracts. */
export interface PrivateCurveTradeParams {
  operation: number;
  /** PrivateCurveExecutor bound to this curve. */
  curveExecutor: string;
  /** Input token the pool withdraws to the executor (base for BUY, memecoin for SELL). */
  inputToken: string;
  /** Output token deposited to the user's open note (memecoin for BUY, base for SELL). */
  outputToken: string;
  /** Input amount in smallest units. */
  amount: bigint;
}

function buildCurveTrade(
  transfers: import("./Strk20Adapter").PrivateTransfersLike,
  params: PrivateCurveTradeParams,
  recipient: string,
  open: unknown,
): BuilderLike {
  const opts = {
    autoSetup: true,
    autoDiscover: { notes: "refresh", channels: "refresh" },
    autoSelectNotes: "naive",
  };
  return transfers
    .build(opts)
    .with(params.inputToken, (x) => x.withdraw({ recipient: params.curveExecutor, amount: params.amount }))
    .with(params.outputToken, (x) => x.transfer({ recipient, amount: open }))
    .invoke(({ openNotes }) => ({
      contractAddress: params.curveExecutor,
      entrypoint: "privacy_invoke",
      calldata: [params.operation, params.inputToken, params.amount, openNotes[0]?.noteId ?? 0n],
    }))
    .surplusTo(recipient);
}

/**
 * Execute a private curve trade through a launchpad PrivateCurveExecutor. Signed by the generic
 * STRK20 user's account (Wallet Core local signer or any compatible signer); no application logic
 * leaks into the generic adapter.
 */
export async function privateCurveTrade(
  adapter: Strk20Adapter,
  user: Strk20User,
  params: PrivateCurveTradeParams,
): Promise<Strk20ExecuteReceipt> {
  const open = await loadOpenNoteSymbol();
  if (open == null) throw new Error("STRK20 SDK did not expose the Open-note symbol.");
  return adapter.executeBuilder(user, (transfers) => buildCurveTrade(transfers, params, user.address, open));
}