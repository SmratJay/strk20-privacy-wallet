/**
 * Privacy Hub — provider abstraction + the single `NearIntentProvider`.
 *
 * The hub routes an intent to a provider. A future provider only has to implement
 * `CrossChainProvider` and register a route — Wallet Core, STRK20, the Shadow Account, and the hub
 * stay unchanged.
 *
 * `NearIntentProvider` is a THIN adapter wrapper: it translates the hub's provider-agnostic types
 * to/from the existing `NearIntentAdapter` types and forwards the lifecycle. It implements NO NEAR
 * HTTP, NO proving, NO solver logic, and NO second signer.
 */
import type {
  NearIntentAdapter,
  NearIntentPhase,
} from "@/features/near-intents";
import type {
  CrossChainPrivateIntent,
  NearIntentQuote,
  NearIntentPrepared,
  NearIntentStatus,
  NearIntentReceipt,
} from "@/features/near-intents";
import { nearIntentPhaseForStatus } from "@/features/near-intents";
import type {
  PrivacyHubIntent,
  PrivacyHubQuote,
  PrivacyHubPrepared,
  PrivacyHubStatus,
  PrivacyHubReceipt,
  PrivacyHubReadiness,
  PrivacyHubPhase,
} from "./types";

/** The minimal cross-chain provider contract a future provider must satisfy. */
export interface CrossChainProvider {
  readonly id: string;
  /** Fetch a pricing quote bound to the intent (never a UI-supplied output). */
  quote(intent: PrivacyHubIntent): Promise<PrivacyHubQuote>;
  /** Reserve/publish what the provider needs to execute (e.g. a deposit address). */
  prepare(intent: PrivacyHubIntent, quote: PrivacyHubQuote | null): Promise<PrivacyHubPrepared>;
  /** Execute: source-side private funding + track to a terminal state. */
  execute(
    intent: PrivacyHubIntent,
    prepared: PrivacyHubPrepared,
    options?: { onPhase?: (phase: PrivacyHubPhase) => void },
  ): Promise<PrivacyHubReceipt>;
  /** Reconcile a previously prepared reference to a terminal state. */
  status(reference: string): Promise<PrivacyHubStatus>;
  /** Optional live pre-flight readiness (defaults to always-ready when absent). */
  readiness?(intent: PrivacyHubIntent): Promise<PrivacyHubReadiness>;
}

/** Map the NEAR adapter's granular phase into the hub's normalized phase (collapse, no fabrication). */
export function nearPhaseToHubPhase(phase: NearIntentPhase): PrivacyHubPhase {
  switch (phase) {
    case "idle":
      return "idle";
    case "quoting":
      return "quoting";
    case "preparing":
    case "intent-created":
      return "preparing";
    case "awaiting-source-deposit":
    case "source-confirming":
      return "funding";
    case "solver-executing":
      return "processing";
    case "destination-pending":
      return "destination-pending";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "refunded":
      return "refunded";
    case "unknown":
      return "unknown";
    default:
      return "processing";
  }
}

/** Map a NEAR status code directly to the hub's normalized phase. */
function nearStatusCodeToHubPhase(code: NearIntentStatus["code"]): PrivacyHubPhase {
  return nearPhaseToHubPhase(nearIntentPhaseForStatus(code));
}

/** Translate a hub intent to the NEAR adapter's intent (the canonical keys are identical + action). */
function toNearIntent(intent: PrivacyHubIntent): CrossChainPrivateIntent {
  return {
    action: "cross-chain.swap",
    sourceChain: intent.sourceChain,
    sourceAsset: intent.sourceAsset,
    sourceAmount: intent.sourceAmount,
    destinationChain: intent.destinationChain,
    destinationAsset: intent.destinationAsset,
    destinationAddress: intent.destinationAddress,
    slippageBps: intent.slippageBps,
    appName: intent.appName,
    nonce: intent.nonce,
    ...(intent.expiry !== undefined ? { expiry: intent.expiry } : {}),
  };
}

function toHubQuote(provider: string, quote: NearIntentQuote): PrivacyHubQuote {
  return {
    route: quote.route,
    provider,
    sourceChain: quote.sourceChain,
    sourceAsset: quote.sourceAsset,
    sourceAmount: quote.sourceAmount,
    destinationChain: quote.destinationChain,
    destinationAsset: quote.destinationAsset,
    destinationAddress: quote.destinationAddress,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    refundFee: quote.refundFee,
    withdrawFee: quote.withdrawFee,
    timeEstimate: quote.timeEstimate,
    deadline: quote.deadline,
    slippageBps: quote.slippageBps,
    providerPayload: quote,
  };
}

function toHubPrepared(route: string, prepared: NearIntentPrepared): PrivacyHubPrepared {
  return {
    route,
    provider: "near-intents",
    reference: prepared.depositAddress,
    sourceAmount: prepared.sourceAmount,
    amountOut: prepared.amountOut,
    minAmountOut: prepared.minAmountOut,
    destinationAddress: prepared.destinationAddress,
    providerPayload: prepared,
  };
}

function toHubStatus(status: NearIntentStatus): PrivacyHubStatus {
  return {
    provider: "near-intents",
    reference: status.depositAddress,
    phase: nearStatusCodeToHubPhase(status.code),
    terminal: status.terminal,
    settled: status.settled,
    amountOut: status.amountOut,
    refundedAmount: status.refundedAmount,
    refundReason: status.refundReason,
    destinationTxHashes: status.destinationChainTxHashes,
  };
}

function toHubReceipt(receipt: NearIntentReceipt): PrivacyHubReceipt {
  return {
    route: "STRK (Starknet) → USDC (Base)",
    provider: "near-intents",
    reference: receipt.depositAddress,
    phase: nearStatusCodeToHubPhase(receipt.status),
    sourceAmount: receipt.sourceAmount,
    destinationAddress: receipt.destinationAddress,
    amountOut: receipt.amountOut,
    transactionHash: receipt.transactionHash,
    destinationTxHashes: receipt.destinationChainTxHashes,
    refundedAmount: receipt.refundedAmount,
    refundReason: receipt.refundReason,
    message: receipt.message,
  };
}

/** Extract the opaque provider payload, re-typed for this provider. */
function asNearQuote(payload: unknown): NearIntentQuote | undefined {
  return payload as NearIntentQuote | undefined;
}
function asNearPrepared(payload: unknown): NearIntentPrepared {
  return payload as NearIntentPrepared;
}

/**
 * The `near-intents` provider: wraps the existing `NearIntentAdapter`. Does not reimplement it.
 */
export class NearIntentProvider implements CrossChainProvider {
  readonly id = "near-intents";

  constructor(private readonly adapter: NearIntentAdapter) {}

  async quote(intent: PrivacyHubIntent): Promise<PrivacyHubQuote> {
    const q = await this.adapter.quote(toNearIntent(intent));
    return toHubQuote(this.id, q);
  }

  async prepare(intent: PrivacyHubIntent, quote: PrivacyHubQuote | null): Promise<PrivacyHubPrepared> {
    const confirmed = quote ? asNearQuote(quote.providerPayload) : undefined;
    const prepared = await this.adapter.createIntent(toNearIntent(intent), confirmed);
    return toHubPrepared(prepared.route, prepared);
  }

  async execute(
    intent: PrivacyHubIntent,
    prepared: PrivacyHubPrepared,
    options: { onPhase?: (phase: PrivacyHubPhase) => void } = {},
  ): Promise<PrivacyHubReceipt> {
    const nearPrepared = asNearPrepared(prepared.providerPayload);
    const receipt = await this.adapter.execute(toNearIntent(intent), nearPrepared, {
      onPhase: (update) => options.onPhase?.(nearPhaseToHubPhase(update.phase)),
    });
    return toHubReceipt(receipt);
  }

  async status(reference: string): Promise<PrivacyHubStatus> {
    const status = await this.adapter.status(reference);
    return toHubStatus(status);
  }

  async readiness(intent: PrivacyHubIntent): Promise<PrivacyHubReadiness> {
    const readiness = await this.adapter.checkReadiness(toNearIntent(intent));
    return {
      provider: this.id,
      ready: readiness.ready,
      checks: readiness.checks,
      reason: readiness.reason,
    };
  }
}
