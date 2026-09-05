import { hash, CallData, type Call } from "starknet";

/**
 * Privacy Core — STRK20 private-paymaster relay (AVNU paymaster protocol v0.1).
 *
 * The STRK20 proof transaction (the pool's `apply_actions` call + proof facts) must NOT be
 * submitted by the user's root Wallet Core account: the shadow-account invariant requires
 * `rootWalletAddress != outerTxSender`. This client relays the call+proof through AVNU's
 * Sepolia paymaster, so the OUTER transaction sender is the paymaster's relayer — never the
 * user's wallet.
 *
 * The user's Wallet Core account still signs the PROOF INVOCATION (the SDK builds it with the
 * wallet's signer — that signature authorizes the private-note spending inside the proof). Only
 * the outer broadcast is relayed.
 *
 * Two fee modes:
 *   - `default`            — gas paid in the gas token (STRK). Credential-free.
 *   - `sponsored_private`  — pool fee withdrawn privately. Requires an API key.
 *
 * Orrange uses the credential-free `default` mode (no server-side key; the master key never
 * leaves Wallet Core). No proof, note, or viewing-key material is persisted anywhere.
 */

export const STRK20_PAYMASTER_URL = "https://sepolia.paymaster.avnu.fi";
export const STRK20_PAYMASTER_FEE_MODE = "default" as const;

export interface PaymasterFee {
  token: string;
  recipient: string;
  amount: bigint;
}

export interface PaymasterBuild {
  readonly parameters: {
    readonly version: "0x1";
    readonly fee_mode: { readonly mode: "default"; readonly gas_token: string };
  };
  readonly fee?: PaymasterFee;
}

export interface PaymasterExecution {
  readonly transactionHash: string;
  readonly trackingId?: string;
}

export interface Strk20PaymasterOptions {
  /** Paymaster JSON-RPC endpoint (defaults to the pinned Sepolia paymaster). */
  url?: string;
  /** Optional server-held API key for `sponsored_private` mode. NEVER a public env var. */
  apiKey?: string;
  feeMode?: "default" | "sponsored_private";
}

/** The paymaster relay accepted the call. A missing response after relay start is "unknown",
 * not a failure — callers must reconcile the relay/chain before retrying. */
export class PaymasterSubmissionUnknownError extends Error {
  override readonly name = "PaymasterSubmissionUnknownError";
  readonly trackingId?: string;
  constructor(message?: string) {
    super(message ?? "Private-paymaster submission status is unknown; reconcile before retrying.");
  }
}

function normalizeAddress(value: string | bigint | number): string {
  return "0x" + BigInt(value).toString(16);
}

export class Strk20Paymaster {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly feeMode: "default" | "sponsored_private";

  constructor(options: Strk20PaymasterOptions = {}) {
    this.url = (options.url ?? STRK20_PAYMASTER_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.feeMode = options.feeMode ?? "default";
    if (!this.url.startsWith("https://")) throw new Error("STRK20 paymaster URL must use HTTPS.");
  }

  /** Build relay terms for a private `apply_actions` proof. The returned fee (a private-note
   * withdrawal) is added to the proof's actions so the paymaster is paid from the private balance. */
  async build(poolAddress: string, gasToken: string): Promise<PaymasterBuild> {
    const result = await this.rpc("paymaster_buildTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: { pool_address: normalizeAddress(poolAddress) },
      },
      parameters: {
        version: "0x1",
        fee_mode:
          this.feeMode === "sponsored_private"
            ? { mode: "sponsored_private", pool_fee_token: normalizeAddress(gasToken) }
            : { mode: "default", gas_token: normalizeAddress(gasToken) },
      },
    });
    return { parameters: result.parameters as PaymasterBuild["parameters"], fee: parseFee(result.fee_action) };
  }

  /** Relay the proven apply_actions call. The outer transaction sender is the paymaster's relayer. */
  async execute(args: {
    poolAddress: string;
    call: Call;
    proof?: string;
    proofFacts: readonly string[];
    build: PaymasterBuild;
  }): Promise<PaymasterExecution> {
    const result = await this.rpc("paymaster_executeTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: {
          pool_address: normalizeAddress(args.poolAddress),
          apply_actions_call: toPaymasterCall(args.call),
          proof: args.proof ?? "",
          proof_facts: args.proofFacts.map(normalizeAddress),
        },
      },
      parameters: args.build.parameters,
    });
    return {
      transactionHash: felt(result.transaction_hash, "transaction_hash"),
      trackingId: optionalFelt(result.tracking_id),
    };
  }

  private async rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.apiKey) headers["x-paymaster-api-key"] = this.apiKey;
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new PaymasterSubmissionUnknownError("Private paymaster could not be reached.");
    }
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new PaymasterSubmissionUnknownError("Private paymaster returned an unreadable response.");
    }
    if (body.error) {
      const err = body.error as { code?: unknown; message?: unknown; data?: unknown };
      const detail = typeof err?.message === "string" ? ` (${err.message})` : "";
      const dataDetail =
        err?.data !== undefined && err?.data !== null
          ? ` data=${typeof err.data === "string" ? err.data.slice(0, 500) : JSON.stringify(err.data).slice(0, 500)}`
          : "";
      throw new Error(`Private paymaster rejected ${method}${detail}${dataDetail}`);
    }
    if (!response.ok) {
      throw new PaymasterSubmissionUnknownError(
        `Private paymaster returned HTTP ${response.status} without a JSON-RPC decision.`,
      );
    }
    return (body.result ?? {}) as Record<string, unknown>;
  }
}

function parseFee(value: unknown): PaymasterFee | undefined {
  if (value === undefined || value === null) return undefined;
  const fee = value as { type?: string; token?: unknown; recipient?: unknown; amount?: unknown };
  if (fee.type !== "withdraw") return undefined;
  return {
    token: felt(fee.token, "fee.token"),
    recipient: felt(fee.recipient, "fee.recipient"),
    amount: BigInt(felt(fee.amount, "fee.amount")),
  };
}

function toPaymasterCall(call: Call): {
  to: string;
  selector: string;
  calldata: string[];
} {
  return {
    to: normalizeAddress(call.contractAddress),
    selector: normalizeAddress(hash.getSelectorFromName(call.entrypoint)),
    calldata: CallData.compile(call.calldata ?? []).map((item) => normalizeAddress(item)),
  };
}

function felt(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${field} must be a felt`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${field} must be non-negative`);
  return normalizeAddress(parsed);
}

function optionalFelt(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : felt(value, "tracking_id");
  } catch {
    return undefined;
  }
}