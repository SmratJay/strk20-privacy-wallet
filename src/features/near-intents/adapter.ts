/**
 * Near Intents — NearIntentAdapter (REAL NEAR Intents cross-chain routing).
 *
 * The feature-level executor that turns a typed `CrossChainPrivateIntent` into a REAL cross-chain
 * swap through the NEAR Intents 1Click API, funded by the EXISTING STRK20 shadow-account path:
 *
 *   private STRK note → shadow identity → shadow account → transfer(STRK → NEAR deposit address)
 *     → NEAR Intents solver swaps STRK → USDC (Base) → destination address receives USDC.
 *
 * It NEVER:
 *   - exposes arbitrary calldata or solver internals to the UI,
 *   - re-implements privacy (STRK20/Shadow Account is the privacy primitive),
 *   - claims NEAR makes the source/destination relationship private,
 *   - falls back to a public master-wallet send (the shadow account is the depositor),
 *   - reports success without destination reconciliation (status === SUCCESS).
 *
 * The root wallet signs the PROOF INVOCATION (via the existing shadow path); the OUTER transaction
 * is relayed by the private paymaster; the NEAR deposit address sees the SHADOW ACCOUNT as the
 * depositor — never the root wallet. See docs/NEAR_INTENTS.md for the exact private/public/linkable
 * boundary.
 */
import { uint256 } from "starknet";
import type { UnlockedWallet } from "@/wallet";
import type { WalletPrivacySession } from "@/wallet/privacy";
import type { WalletNetworkId } from "@/wallet";
import type { ShadowCallLike } from "@/privacy/strk20";
import { NearIntentClient, type OneClickStatusResponse } from "./client";
import { crossChainConfigFor, type CrossChainNetworkConfig } from "./config";
import {
  resolveNearIntentRoute,
  type NearIntentRoute,
} from "./routes";
import {
  validateCrossChainIntent,
  validateDestinationAddress,
  computeMinOutput,
  isValidStarknetAddress,
  nearIntentPhaseForStatus,
  NearIntentError,
  NearIntentQuoteStaleError,
  NearIntentUnsupportedRouteError,
  NearIntentRejectedError,
  NearIntentUnknownError,
  type CrossChainPrivateIntent,
  type NearIntentQuote,
  type NearIntentPrepared,
  type NearIntentStatus,
  type NearIntentStatusCode,
  type NearIntentPhase,
  type NearIntentReceipt,
} from "./types";

/** Quote freshness window for the dry (pricing) quote. */
const DRY_QUOTE_TTL_MS = 3 * 60 * 1000;
/** Quote freshness window for the live (deposit-reserving) quote — generous for shadow proving. */
const LIVE_QUOTE_TTL_MS = 60 * 60 * 1000;
/** Default settle-tracking window before reporting "unknown". */
const DEFAULT_TRACK_TIMEOUT_MS = 15 * 60 * 1000;
/** Poll interval for the status endpoint. */
const STATUS_POLL_MS = 10 * 1000;

const TERMINAL_CODES: readonly NearIntentStatusCode[] = ["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"];

/** A lifecycle update the adapter emits to the runtime (never contains secrets). */
export interface NearIntentPhaseUpdate {
  phase: NearIntentPhase;
  status?: NearIntentStatusCode;
  amountOut?: bigint | null;
}

/** A single pre-flight readiness check result (never contains secrets). */
export interface NearIntentReadinessCheck {
  name: string;
  ok: boolean;
  detail: string | null;
}

/** Structured live-readiness result for funding a cross-chain deposit. */
export interface NearIntentReadiness {
  ready: boolean;
  checks: NearIntentReadinessCheck[];
  reason: string | null;
}

export interface NearIntentAdapterOptions {
  wallet: UnlockedWallet;
  privacySession: WalletPrivacySession;
  network: WalletNetworkId;
  /** Test seam: inject a client (deterministic HTTP). */
  client?: NearIntentClient;
  /** Test seam: inject a cross-chain network config (to force settlement in tests). */
  config?: CrossChainNetworkConfig;
}

/** Encode an ERC20 u256 `transfer(recipient, amount)` calldata for the shadow account. */
export function transferCalldata(recipient: string, amount: bigint): string[] {
  const u256 = uint256.bnToUint256(amount);
  return [recipient, String(u256.low), String(u256.high)];
}

export class NearIntentAdapter {
  readonly name = "near-intent-adapter";
  private readonly wallet: UnlockedWallet;
  private readonly privacySession: WalletPrivacySession;
  private readonly network: WalletNetworkId;
  private readonly client: NearIntentClient;
  private readonly config: CrossChainNetworkConfig;

  constructor(options: NearIntentAdapterOptions) {
    this.wallet = options.wallet;
    this.privacySession = options.privacySession;
    this.network = options.network;
    this.config = options.config ?? crossChainConfigFor(this.network);
    this.client = options.client ?? new NearIntentClient({ baseUrl: this.config.nearBaseUrl });
  }

  /** Resolve the single supported route for an intent (throws on unknown routes). */
  private resolveRoute(intent: Pick<CrossChainPrivateIntent, "sourceChain" | "sourceAsset" | "destinationChain" | "destinationAsset">): NearIntentRoute {
    const route = resolveNearIntentRoute(
      intent.sourceChain,
      intent.sourceAsset,
      intent.destinationChain,
      intent.destinationAsset,
    );
    if (!route) {
      throw new NearIntentUnsupportedRouteError(
        `Unsupported cross-chain route: ${intent.sourceChain}:${intent.sourceAsset} → ${intent.destinationChain}:${intent.destinationAsset}.`,
      );
    }
    return route;
  }

  /**
   * Gate the API layer (quote / reserve deposit address / status) on the STRK20 stack being
   * configured for this network. Reports unavailability — never a public fallback.
   */
  private requireAvailable(): void {
    if (!this.config.available) {
      throw new NearIntentError(
        `Cross-chain intents are unavailable on ${this.network}${this.config.reason ? `: ${this.config.reason}` : "."}`,
      );
    }
  }

  /**
   * LIVE readiness check — run BEFORE funding a NEAR deposit. Never a public fallback. Returns a
   * structured result (does not throw) so the caller can surface exactly which prerequisite failed
   * and stop before creating/funding the live deposit.
   */
  async checkReadiness(intent: CrossChainPrivateIntent): Promise<NearIntentReadiness> {
    const checks: NearIntentReadinessCheck[] = [];
    const add = (name: string, ok: boolean, detail: string | null = null) => checks.push({ name, ok, detail });

    const invalid = validateCrossChainIntent(intent);
    add("intent valid", !invalid, invalid);

    // The authoritative cross-chain config already encodes: active network is mainnet + STRK20
    // configured + mainnet private paymaster relay. `settlementEnabled` is only true when all three
    // hold, so a non-mainnet (or unconfigured) network fails here with an honest reason.
    add(
      "mainnet settlement enabled",
      this.config.settlementEnabled,
      this.config.settlementEnabled ? null : (this.config.reason ?? `active network is ${this.network}`),
    );

    const destInvalid = validateDestinationAddress(intent.destinationAddress);
    add("destination valid", !destInvalid, destInvalid);

    // Route resolution (also yields the source token address for the balance check).
    let route: NearIntentRoute | null = null;
    let routeDetail: string | null = null;
    try {
      route = this.resolveRoute(intent);
    } catch (err) {
      routeDetail = err instanceof Error ? err.message : "unknown route error";
    }
    add("route supported", route !== null, routeDetail);

    // Shadow identity must resolve for THIS wallet + network (private execution identity).
    let identityOk = true;
    let identityDetail: string | null = null;
    try {
      this.resolveIdentity(intent.appName, intent.nonce);
    } catch (err) {
      identityOk = false;
      identityDetail = err instanceof Error ? err.message : "unknown identity error";
    }
    add("shadow identity resolvable", identityOk, identityDetail);

    // Enough (mature) private STRK to cover the source amount. The exact relay fee is discovered
    // at execution; this is a minimal floor, not the total.
    let balanceOk = true;
    let balanceDetail: string | null = null;
    if (route) {
      try {
        const snapshot = await this.privacySession.getPrivateBalanceSnapshot(route.sourceToken.address);
        if (snapshot.balance < intent.sourceAmount) {
          balanceOk = false;
          balanceDetail = `private balance ${snapshot.balance} < source amount ${intent.sourceAmount}`;
        }
      } catch (err) {
        balanceOk = false;
        balanceDetail = err instanceof Error ? err.message : "could not read private balance";
      }
      add("enough private STRK", balanceOk, balanceDetail);
    }

    const failures = checks.filter((c) => !c.ok);
    return {
      ready: failures.length === 0,
      checks,
      reason: failures.length > 0 ? failures.map((f) => f.name).join(", ") : null,
    };
  }

  private resolveIdentity(appName: string, nonce: bigint) {
    return this.privacySession.getShadowIdentity(appName, nonce, this.wallet.address);
  }

  /**
   * Fetch a REAL dry (pricing-only) quote from the NEAR Intents 1Click API. The quote is bound to
   * the exact route + amount + destination address and never trusted from the UI.
   */
  async quote(intent: CrossChainPrivateIntent): Promise<NearIntentQuote> {
    const invalid = validateCrossChainIntent(intent);
    if (invalid) throw new NearIntentError(`Invalid cross-chain intent: ${invalid}`);
    this.requireAvailable();
    const route = this.resolveRoute(intent);
    if (validateDestinationAddress(intent.destinationAddress)) {
      throw new NearIntentError("Invalid destination address.");
    }
    const response = await this.client.requestQuote({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: intent.slippageBps,
      originAsset: route.originAssetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: route.destinationAssetId,
      amount: intent.sourceAmount.toString(),
      recipient: intent.destinationAddress,
      recipientType: "DESTINATION_CHAIN",
      // A dry quote does not fund anything; refundTo is still validated by the API.
      refundTo: this.wallet.address,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + DRY_QUOTE_TTL_MS).toISOString(),
    });
    return this.toQuote(response, route, intent);
  }

  /**
   * RESERVE a deposit address (publish step): a live (non-dry) quote from the 1Click API. The
   * returned deposit address is where the shadow account will transfer STRK. The quote is
   * re-validated against the confirmed quote — a stale/mutated quote is rejected.
   */
  async createIntent(
    intent: CrossChainPrivateIntent,
    confirmedQuote?: NearIntentQuote,
  ): Promise<NearIntentPrepared> {
    const invalid = validateCrossChainIntent(intent);
    if (invalid) throw new NearIntentError(`Invalid cross-chain intent: ${invalid}`);
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new NearIntentError("Cross-chain intent has expired.");
    }
    this.requireAvailable();
    const route = this.resolveRoute(intent);

    // Resolve the shadow identity: it is the privacy-preserving refund target.
    const identity = this.resolveIdentity(intent.appName, intent.nonce);

    const response = await this.client.requestQuote({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: intent.slippageBps,
      originAsset: route.originAssetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: route.destinationAssetId,
      amount: intent.sourceAmount.toString(),
      recipient: intent.destinationAddress,
      recipientType: "DESTINATION_CHAIN",
      refundTo: identity.shadowAddress,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + LIVE_QUOTE_TTL_MS).toISOString(),
    });

    const quote = this.toQuote(response, route, intent);

    // Re-validate against the confirmed quote (stale/mutated → refuse BEFORE funding).
    if (confirmedQuote) {
      if (confirmedQuote.sourceAsset !== intent.sourceAsset || confirmedQuote.sourceAmount !== intent.sourceAmount) {
        throw new NearIntentError("The confirmed quote does not match the intent.");
      }
      if (confirmedQuote.destinationAddress.toLowerCase() !== intent.destinationAddress.toLowerCase()) {
        throw new NearIntentError("The confirmed quote does not match the destination address.");
      }
      const referenceAmountOut = confirmedQuote.amountOut;
      const floor = computeMinOutput(referenceAmountOut, intent.slippageBps);
      if (quote.amountOut < floor) {
        throw new NearIntentQuoteStaleError();
      }
    }

    const depositAddress = response.quote?.depositAddress;
    if (!depositAddress || !isValidStarknetAddress(depositAddress)) {
      throw new NearIntentError("NEAR Intents did not return a valid Starknet deposit address.");
    }

    return {
      ...quote,
      depositAddress,
      depositAddressDeadline: response.quote?.timeWhenInactive ?? response.quote?.deadline ?? quote.deadline,
      intentId: response.correlationId ?? "",
      sourceTokenAddress: route.sourceToken.address,
    };
  }

  /**
   * Execute the cross-chain intent: the shadow account transfers private STRK to the reserved
   * deposit address, then the adapter tracks the NEAR settlement to a terminal state.
   *
   * Returns a receipt with a reconciled terminal status (SUCCESS / REFUNDED / FAILED /
   * INCOMPLETE_DEPOSIT). Throws `NearIntentUnknownError` when the settlement cannot be reconciled
   * within the tracking window (the deposit remains on-chain; poll `getCrossChainStatus` later).
   */
  async execute(
    intent: CrossChainPrivateIntent,
    prepared: NearIntentPrepared,
    options: {
      trackTimeoutMs?: number;
      pollMs?: number;
      /** Lifecycle callback (source-side + solver-side phases) for the runtime's honest view. */
      onPhase?: (update: NearIntentPhaseUpdate) => void;
    } = {},
  ): Promise<NearIntentReceipt> {
    const invalid = validateCrossChainIntent(intent);
    if (invalid) throw new NearIntentError(`Invalid cross-chain intent: ${invalid}`);
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new NearIntentError("Cross-chain intent has expired.");
    }
    // LIVE pre-flight readiness check — STOP before funding if any prerequisite fails.
    const readiness = await this.checkReadiness(intent);
    if (!readiness.ready) {
      throw new NearIntentError(`Cross-chain pre-flight failed before funding: ${readiness.reason}.`);
    }
    const route = this.resolveRoute(intent);

    // Defensive re-validation: the prepared object must match the intent exactly (never trust a
    // mutated/foreign prepared object). This is the immutable execution tuple.
    if (prepared.sourceChain !== intent.sourceChain || prepared.sourceAsset !== intent.sourceAsset) {
      throw new NearIntentError("The prepared intent does not match the source chain/asset.");
    }
    if (prepared.sourceAmount !== intent.sourceAmount) {
      throw new NearIntentError("The prepared intent does not match the source amount.");
    }
    if (prepared.destinationChain !== intent.destinationChain || prepared.destinationAsset !== intent.destinationAsset) {
      throw new NearIntentError("The prepared intent does not match the destination chain/asset.");
    }
    if (prepared.destinationAddress.toLowerCase() !== intent.destinationAddress.toLowerCase()) {
      throw new NearIntentError("The prepared intent does not match the destination address.");
    }
    if (!prepared.depositAddress || !isValidStarknetAddress(prepared.depositAddress)) {
      throw new NearIntentError("The prepared intent is missing a valid deposit address.");
    }
    if (!prepared.intentId) {
      throw new NearIntentError("The prepared intent is missing its NEAR correlation id.");
    }

    // Resolve the shadow identity (authority + private execution identity). The root wallet is
    // never the on-chain depositor: the shadow account transfers STRK to the NEAR deposit address.
    const identity = this.resolveIdentity(intent.appName, intent.nonce);

    // The single Starknet call the shadow account executes: transfer STRK → NEAR deposit address.
    const calls: ShadowCallLike[] = [
      {
        contractAddress: route.sourceToken.address,
        entrypoint: "transfer",
        calldata: transferCalldata(prepared.depositAddress, intent.sourceAmount),
      },
    ];

    // Source side: private STRK → shadow account → NEAR deposit (private execution identity funds).
    options.onPhase?.({ phase: "awaiting-source-deposit" });
    const result = await this.privacySession.executeShadowApplication({
      appName: identity.appName,
      nonce: intent.nonce,
      token: route.sourceToken.address,
      amount: intent.sourceAmount,
      calls,
      destination: this.wallet.address,
    });
    options.onPhase?.({ phase: "source-confirming" });

    // Best-effort: notify 1Click of the deposit tx (non-fatal; status polling still works).
    try {
      await this.client.submitDepositTx(prepared.depositAddress, result.transactionHash);
    } catch {
      // ignore — detection proceeds via on-chain indexing.
    }

    const status = await this.trackStatus(prepared.depositAddress, options);

    return {
      intentId: prepared.intentId,
      depositAddress: prepared.depositAddress,
      status: status.code,
      sourceChain: "starknet",
      destinationChain: "base",
      sourceAsset: "strk",
      sourceAmount: intent.sourceAmount,
      destinationAsset: "usdc",
      destinationAddress: intent.destinationAddress,
      amountOut: status.amountOut,
      shadowAddress: result.shadowAddress,
      commitment: result.commitment,
      transactionHash: result.transactionHash,
      nearTxHashes: status.nearTxHashes,
      destinationChainTxHashes: status.destinationChainTxHashes,
      refundedAmount: status.refundedAmount,
      refundReason: status.refundReason,
    };
  }

  /** Poll the 1Click status endpoint and reconcile to a terminal state. Never fabricates success. */
  async status(depositAddress: string): Promise<NearIntentStatus> {
    if (!isValidStarknetAddress(depositAddress)) {
      throw new NearIntentError("Invalid deposit address for status polling.");
    }
    const response = await this.client.getStatus(depositAddress);
    return this.toStatus(response, depositAddress);
  }

  /** Poll until terminal (or timeout → `NearIntentUnknownError`). */
  private async trackStatus(
    depositAddress: string,
    options: { trackTimeoutMs?: number; pollMs?: number; onPhase?: (update: NearIntentPhaseUpdate) => void },
  ): Promise<NearIntentStatus> {
    const timeoutMs = options.trackTimeoutMs ?? DEFAULT_TRACK_TIMEOUT_MS;
    const pollMs = options.pollMs ?? STATUS_POLL_MS;
    const startedAt = Date.now();
    for (;;) {
      let status: NearIntentStatus;
      try {
        status = await this.status(depositAddress);
      } catch (err) {
        if (Date.now() - startedAt >= timeoutMs) {
          throw new NearIntentUnknownError(
            `Could not reconcile the cross-chain intent status${err instanceof Error ? ` (${err.message})` : ""}.`,
          );
        }
        await sleep(pollMs);
        continue;
      }
      options.onPhase?.({
        phase: nearIntentPhaseForStatus(status.code),
        status: status.code,
        amountOut: status.amountOut,
      });
      if (status.terminal) return status;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new NearIntentUnknownError(
          `Cross-chain intent did not settle within ${timeoutMs}ms (last status ${status.code}).`,
        );
      }
      await sleep(pollMs);
    }
  }

  private toQuote(
    response: { quote?: { amountOut?: string; refundFee?: string; withdrawFee?: string; timeEstimate?: number; deadline?: string } },
    route: NearIntentRoute,
    intent: CrossChainPrivateIntent,
  ): NearIntentQuote {
    const amountOut = BigInt(response.quote?.amountOut ?? "0");
    if (amountOut <= 0n) {
      throw new NearIntentError("NEAR Intents returned a zero quote for this route.");
    }
    return {
      sourceChain: "starknet",
      sourceAsset: "strk",
      sourceAmount: intent.sourceAmount,
      destinationChain: "base",
      destinationAsset: "usdc",
      destinationAddress: intent.destinationAddress,
      amountOut,
      minAmountOut: computeMinOutput(amountOut, intent.slippageBps),
      refundFee: BigInt(response.quote?.refundFee ?? "0"),
      withdrawFee: BigInt(response.quote?.withdrawFee ?? "0"),
      timeEstimate: response.quote?.timeEstimate ?? 0,
      deadline: response.quote?.deadline ?? new Date(Date.now() + DRY_QUOTE_TTL_MS).toISOString(),
      route: route.name,
      slippageBps: intent.slippageBps,
    };
  }

  private toStatus(response: OneClickStatusResponse, depositAddress: string): NearIntentStatus {
    const code = (response.status ?? "FAILED") as NearIntentStatusCode;
    if (!TERMINAL_CODES.includes(code) && !["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING"].includes(code)) {
      throw new NearIntentRejectedError(`NEAR Intents returned an unrecognized status: ${response.status}`);
    }
    const details = response.swapDetails ?? {};
    const amountIn = details.amountIn != null ? BigInt(details.amountIn) : null;
    const amountOut = details.amountOut != null ? BigInt(details.amountOut) : null;
    const terminal = TERMINAL_CODES.includes(code);
    // Success is claimed ONLY when the service reports SUCCESS (destination settlement confirmed).
    const settled = code === "SUCCESS";
    return {
      code,
      depositAddress,
      intentHashes: details.intentHashes ?? [],
      nearTxHashes: details.nearTxHashes ?? [],
      originChainTxHashes: details.originChainTxHashes ?? [],
      destinationChainTxHashes: details.destinationChainTxHashes ?? [],
      amountIn,
      amountOut,
      refundedAmount: details.refundedAmount != null ? BigInt(details.refundedAmount) : 0n,
      refundReason: details.refundReason ?? null,
      terminal,
      settled,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
