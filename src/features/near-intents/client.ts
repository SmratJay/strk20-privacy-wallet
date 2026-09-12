/**
 * Near Intents — NEAR_INTENTS 1Click API HTTP client.
 *
 * The ONLY place that knows the 1Click API endpoints. A minimal, typed, keyless client over the
 * public REST surface (the ORIGIN_CHAIN deposit flow needs no NEAR credentials):
 *
 *   GET  /v0/tokens                 → live supported destination registry
 *   POST /v0/quote                  → dry (pricing) or live (reserve a deposit address) quote
 *   POST /v0/deposit/submit         → notify 1Click of the Starknet deposit tx hash (optional)
 *   GET  /v0/status?depositAddress= → poll settlement status
 *
 * No NEAR credentials, viewing keys, notes, proofs, or secret material ever enter this client. The
 * optional partner JWT (0.2% fee waiver) is intentionally NOT implemented — it must stay server-only.
 */
import { NearIntentError } from "./types";
import { NEAR_INTENTS_1CLICK_BASE_URL } from "./routes";

export interface NearIntentClientOptions {
  /** 1Click API base URL (defaults to the public production endpoint). */
  baseUrl?: string;
  /** fetch override (test seam). */
  fetch?: typeof fetch;
}

/** The exact fields the 1Click quote endpoint accepts (subset we build). */
export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
}

/** The exact fields the 1Click quote endpoint returns (subset we read). */
export interface OneClickQuoteResponse {
  quoteRequest?: OneClickQuoteRequest;
  quote?: {
    amountIn?: string;
    amountOut?: string;
    minAmountOut?: string;
    refundFee?: string;
    withdrawFee?: string;
    timeEstimate?: number;
    deadline?: string;
    timeWhenInactive?: string;
    depositAddress?: string;
  };
  correlationId?: string;
  message?: string;
}

/** The exact fields the 1Click status endpoint returns (subset we read). */
export interface OneClickStatusResponse {
  status?: string;
  correlationId?: string;
  swapDetails?: {
    intentHashes?: string[];
    nearTxHashes?: string[];
    originChainTxHashes?: (string | { hash: string; explorerUrl?: string })[];
    destinationChainTxHashes?: (string | { hash: string; explorerUrl?: string })[];
    amountIn?: string | null;
    amountOut?: string | null;
    refundedAmount?: string | null;
    refundReason?: string | null;
  };
  message?: string;
}

export class NearIntentClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NearIntentClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? NEAR_INTENTS_1CLICK_BASE_URL).replace(/\/+$/, "");
    // A native browser fetch cannot be invoked with NearIntentClient as its receiver.
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async getTokens(): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/v0/tokens`, {
      cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new NearIntentError(`Destination registry unavailable (HTTP ${response.status}). Try again.`);
    return response.json();
  }

  /** Request a quote (dry or live). Never parses solver internals — returns the raw public quote. */
  async requestQuote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v0/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as OneClickQuoteResponse & { message?: string };
    if (!response.ok) {
      throw new NearIntentError(
        `NEAR Intents quote failed (HTTP ${response.status})${body?.message ? `: ${body.message}` : ""}`,
      );
    }
    return body;
  }

  /** Notify 1Click of the on-chain deposit tx hash (optional; speeds up detection). */
  async submitDepositTx(depositAddress: string, txHash: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/v0/deposit/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ depositAddress, txHash }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      // A failed notify is non-fatal: the status endpoint still detects the deposit on-chain.
      return;
    }
  }

  /** Poll settlement status by deposit address. */
  async getStatus(depositAddress: string): Promise<OneClickStatusResponse> {
    const url = `${this.baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as OneClickStatusResponse & { message?: string };
    if (!response.ok) {
      throw new NearIntentError(
        `NEAR Intents status failed (HTTP ${response.status})${body?.message ? `: ${body.message}` : ""}`,
      );
    }
    return body;
  }
}
