import type { Strk20Adapter, Strk20ExecuteReceipt, Strk20User, BuilderLike } from "./Strk20Adapter";

/**
 * Privacy Core — private application invoke (the first APPLICATION adapter on the generic
 * `Strk20Adapter`).
 *
 * This module keeps application-specific action construction OUT of the generic STRK20 adapter,
 * exactly like `privateCurve.ts`: the generic adapter only knows how to execute SDK builders,
 * this module knows how to build the private application action graph:
 *
 *   1. withdraw input token → target application   (the pool pays the application on-chain)
 *   2. invoke(target, privacy_invoke)              (the pool calls the application's
 *                                                    `privacy_invoke(identity, amount)` selector)
 *   3. surplusTo(user)                             (any note surplus returns to the user's own note)
 *
 * The application executes under the shadow identity the caller passes as `identityCommitment`
 * (a PUBLIC STRK20 shadow-account commitment). The pool is the caller the application sees —
 * never the user's master wallet address.
 *
 * This is NOT a swap system and NOT a generalized protocol: it is the minimal, SDK-supported
 * execution primitive that proves a private STRK20 balance can cause an external Starknet
 * application action without falling back to the public master-wallet path.
 */

/** Minimal private application execution parameters. */
export interface PrivateApplicationInvokeParams {
  /** External Starknet application contract implementing `privacy_invoke`. */
  targetContract: string;
  /** Token (STRK20 asset) the private balance spends on the application. */
  token: string;
  /** Amount in base units (u128-safe; mirrors the launchpad executor's u128 amounts). */
  amount: bigint;
  /** PUBLIC shadow-account commitment the application executes under (never the master wallet). */
  identityCommitment: string;
  /** Optional surplus recipient (defaults to the user's own wallet). */
  destination?: string;
}

function buildApplicationInvoke(
  transfers: import("./Strk20Adapter").PrivateTransfersLike,
  params: PrivateApplicationInvokeParams,
  recipient: string,
): BuilderLike {
  const opts = {
    autoSetup: true,
    autoDiscover: { notes: "refresh", channels: "refresh" },
    autoSelectNotes: "naive",
  };
  const destination = params.destination?.trim() ? params.destination : recipient;
  return (
    transfers
      .build(opts)
      .with(params.token, (x) => x.withdraw({ recipient: params.targetContract, amount: params.amount }))
      // The pool invokes the target's `privacy_invoke(identity, amount)` AFTER the withdraw
      // lands, within the same apply_actions proof transaction. The identity is the shadow
      // commitment, so the application can attribute the action to a private execution identity
      // without ever learning the user's master wallet address.
      .invoke(() => ({
        contractAddress: params.targetContract,
        entrypoint: "privacy_invoke",
        calldata: [params.identityCommitment, params.amount],
      }))
      .surplusTo(destination)
  );
}

/**
 * Execute a private application action through the generic STRK20 adapter. Signed by the generic
 * STRK20 user's account (the Wallet Core local signer); no application logic leaks into the
 * generic adapter. Requires a live privacy session (viewing key + adapter), never a public
 * master-wallet fallback.
 */
export async function privateApplicationInvoke(
  adapter: Strk20Adapter,
  user: Strk20User,
  params: PrivateApplicationInvokeParams,
): Promise<Strk20ExecuteReceipt> {
  if (params.amount <= 0n) throw new Error("Private application amount must be positive.");
  if (params.amount > BigInt("340282366920938463463374607431768211455")) {
    throw new Error("Private application amount exceeds the u128 range of the acceptance probe.");
  }
  return adapter.executeBuilder(user, (transfers) => buildApplicationInvoke(transfers, params, user.address));
}