/**
 * Starkscan STRK20 prover relay client (server-side only).
 *
 * Implements the CURRENT official Starkscan STRK20 prover API
 * (https://starkscan.co/docs/api/strk20-prover) exactly as documented:
 *
 *   POST /v1/SN_MAIN/prove        (X-Starkscan-Api-Key + Idempotency-Key; async job)
 *   GET  /v1/SN_MAIN/prove/{jobId} (poll until terminal)
 *
 * This runs ONLY on the server so the `STARKSCAN_API_KEY` never reaches the browser. The browser
 * SDK keeps talking to its normal synchronous `starknet_proveTransaction` endpoint — that endpoint
 * is our Next.js route, which translates to this async job+poll relay and returns the proof in the
 * same synchronous shape (`{ proof, proof_facts, l2_to_l1_messages, additional_data }`).
 *
 * The relay is mainnet-only, operator-issued, and async (a proof occupies a prover slot for an
 * unbounded, workload-dependent duration). Errors are mapped faithfully (401 auth, 403 no scope,
 * 404 dormant, 429 budget/concurrency, 503 queue/prover, terminal job failures).
 */
import { randomUUID } from "node:crypto";

export const STARKSAN_PROVE_BASE_URL = "https://api.starkscan.co/v1/SN_MAIN";

export interface StarkscanProverOptions {
  /** The operator-approved Starkscan API key. SERVER-ONLY. */
  apiKey: string;
  baseUrl?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  submitTimeoutMs?: number;
  pollTimeoutMs?: number;
}

export interface StarkscanProveRequest {
  block_id: { block_number: number } | { tag: string } | string;
  transaction: unknown;
}

/** Terminal job outcome from the Starkscan relay. */
export type StarkscanJobStatus = "succeeded" | "failed" | "unavailable" | "unknown_delivery";

export class StarkscanProverError extends Error {
  override readonly name = "StarkscanProverError";
  constructor(
    message: string,
    readonly kind:
      | "auth"
      | "forbidden"
      | "dormant"
      | "budget"
      | "queue"
      | "rejected"
      | "delivery-unknown"
      | "http",
    readonly status?: number,
    readonly code?: string | number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class StarkscanProver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly submitTimeoutMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: StarkscanProverOptions) {
    if (!options.apiKey) throw new StarkscanProverError("STARKSCAN_API_KEY is not configured.", "auth");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? STARKSAN_PROVE_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.submitTimeoutMs = options.submitTimeoutMs ?? 30_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 30_000;
  }

  /**
   * Submit a proof request and poll the job to a terminal state. Returns the prover `result`
   * (`{ proof, proof_facts, l2_to_l1_messages, additional_data }`) — the exact shape the browser
   * SDK's synchronous `starknet_proveTransaction` expects. Throws `StarkscanProverError` otherwise.
   */
  async proveTransaction(request: StarkscanProveRequest): Promise<Record<string, unknown>> {
    // One fresh idempotency key per logical submission, reused on every retry (safe dedup).
    const idempotencyKey = randomUUID();

    let submit: Response;
    try {
      submit = await this.fetchImpl(`${this.baseUrl}/prove`, {
        method: "POST",
        headers: {
          "X-Starkscan-Api-Key": this.apiKey,
          "Idempotency-Key": idempotencyKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.submitTimeoutMs),
      });
    } catch (err) {
      throw new StarkscanProverError(
        `Starkscan relay unreachable (${err instanceof Error ? err.message : "network error"}).`,
        "http",
      );
    }

    if (!submit.ok) {
      this.throwForSubmitStatus(submit.status);
    }

    const submitted = (await submit.json()) as { jobId?: string; status?: string };
    if (!submitted.jobId) {
      throw new StarkscanProverError("Starkscan relay did not return a jobId.", "http", submit.status);
    }

    const jobId = submitted.jobId;

    // Poll until terminal; honor pollAfterSeconds (never spin).
    for (;;) {
      let poll: Response;
      try {
        poll = await this.fetchImpl(`${this.baseUrl}/prove/${jobId}`, {
          headers: { "X-Starkscan-Api-Key": this.apiKey },
          signal: AbortSignal.timeout(this.pollTimeoutMs),
        });
      } catch (err) {
        throw new StarkscanProverError(
          `Starkscan poll failed (${err instanceof Error ? err.message : "network error"}).`,
          "http",
        );
      }
      if (!poll.ok) {
        // A 4xx on poll is terminal-adjacent; surface it clearly.
        this.throwForSubmitStatus(poll.status);
      }
      const body = (await poll.json()) as {
        status?: string;
        terminal?: boolean;
        result?: Record<string, unknown>;
        error?: { code?: string | number; message?: string };
        pollAfterSeconds?: number;
        resultUnavailableReason?: string;
      };

      if (!body.terminal) {
        await sleep(body.pollAfterSeconds ?? 10);
        continue;
      }

      if (body.status === "succeeded") {
        if (!body.result) {
          throw new StarkscanProverError(
            `Proof delivered already or expired (${body.resultUnavailableReason ?? "delivered_or_expired"}); resubmit to prove again.`,
            "rejected",
            200,
            body.error?.code,
          );
        }
        return body.result;
      }

      // Terminal non-success: failed / unavailable / unknown_delivery.
      if (body.status === "unknown_delivery") {
        throw new StarkscanProverError(
          `Starkscan cannot confirm delivery (jobId ${jobId}). Do not auto-resubmit.`,
          "delivery-unknown",
          200,
          body.error?.code,
        );
      }
      throw new StarkscanProverError(
        `Starkscan proof job ${body.status}${body.error?.message ? `: ${body.error.message}` : ""} (jobId ${jobId}).`,
        body.status === "failed" ? "rejected" : "rejected",
        200,
        body.error?.code,
      );
    }
  }

  private throwForSubmitStatus(status: number): never {
    switch (status) {
      case 401:
        throw new StarkscanProverError("Starkscan relay requires a valid API key (401).", "auth", status);
      case 403:
        throw new StarkscanProverError("Starkscan key lacks prove scope (403).", "forbidden", status);
      case 404:
        throw new StarkscanProverError(
          "Starkscan relay is not enabled in this environment (404 — dormant surface).",
          "dormant",
          status,
        );
      case 409:
        throw new StarkscanProverError("Starkscan idempotency key reused for a different request (409).", "rejected", status);
      case 429:
        throw new StarkscanProverError("Starkscan prover budget/concurrency exhausted (429).", "budget", status);
      case 503:
        throw new StarkscanProverError("Starkscan prover queue full or unavailable (503).", "queue", status);
      default:
        throw new StarkscanProverError(`Starkscan relay HTTP ${status}.`, "http", status);
    }
  }
}
