/**
 * @file starkscanProver.test.ts
 * @description Final MVP — Starkscan mainnet STRK20 prover relay client. Behavior-first coverage of
 *   the server-side prove proxy translation: auth header, idempotency key, async submit+poll, proof
 *   result mapping, and faithful error mapping (401/403/404/429/503/terminal failures). The relay is
 *   MOCKED (no real proof, no real key).
 */

import { describe, it, expect, vi } from "vitest";
import { StarkscanProver, StarkscanProverError } from "../services/starkscanProver";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
}

describe("StarkscanProver", () => {
  it("submits with the auth + idempotency headers and returns the proof synchronously", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = makeFetch(async (url, init) => {
      seen.push({ url, init });
      if (init?.method === "POST") {
        return jsonResponse(202, { jobId: "prv_123", status: "queued", terminal: false });
      }
      // poll
      return jsonResponse(200, {
        jobId: "prv_123",
        status: "succeeded",
        terminal: true,
        result: {
          proof: "0xproof",
          proof_facts: ["0xfact1", "0xfact2"],
          l2_to_l1_messages: [{ from_address: "0xpool", to_address: "0xl1", payload: ["0x1", "0x2"] }],
          additional_data: { signature: { issued_at: 123, sig_r: "0xr", sig_s: "0xs" } },
        },
      });
    });

    const prover = new StarkscanProver({ apiKey: "secret-key", fetchImpl });
    const result = await prover.proveTransaction({
      block_id: { block_number: 12446898 },
      transaction: { type: "INVOKE", sender_address: "0xabc" },
    });

    // Auth + idempotency headers present on the submit call.
    const submit = seen.find((s) => s.init?.method === "POST");
    expect(submit).toBeDefined();
    const headers = submit!.init!.headers as Record<string, string>;
    expect(headers["X-Starkscan-Api-Key"]).toBe("secret-key");
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(submit!.url).toContain("/prove");
    // Submit body carries block_id + transaction unchanged.
    expect(JSON.parse(String(submit!.init!.body))).toEqual({
      block_id: { block_number: 12446898 },
      transaction: { type: "INVOKE", sender_address: "0xabc" },
    });

    // Poll happened against the job id.
    expect(seen.some((s) => s.url.includes("/prove/prv_123") && s.init?.method !== "POST")).toBe(true);

    // Proof returned synchronously in the SDK-expected shape.
    expect(result.proof).toBe("0xproof");
    expect(result.proof_facts).toEqual(["0xfact1", "0xfact2"]);
    const additionalData = result.additional_data as { signature?: { sig_r?: string } } | undefined;
    expect(additionalData?.signature?.sig_r).toBe("0xr");
  });

  it("polls through non-terminal states until terminal", async () => {
    let polls = 0;
    const fetchImpl = makeFetch(async (url, init) => {
      if (init?.method === "POST") return jsonResponse(202, { jobId: "prv_1", terminal: false });
      polls++;
      if (polls < 3) {
        return jsonResponse(200, { jobId: "prv_1", status: "dispatched", terminal: false });
      }
      return jsonResponse(200, {
        jobId: "prv_1",
        status: "succeeded",
        terminal: true,
        result: { proof: "0xproof", proof_facts: [], l2_to_l1_messages: [] },
      });
    });
    const prover = new StarkscanProver({ apiKey: "k", fetchImpl });
    const result = await prover.proveTransaction({ block_id: { block_number: 1 }, transaction: {} });
    expect(polls).toBe(3);
    expect(result.proof).toBe("0xproof");
  });

  it("reports a terminal failure faithfully (never a fake proof)", async () => {
    const fetchImpl = makeFetch(async (url, init) => {
      if (init?.method === "POST") return jsonResponse(202, { jobId: "prv_fail", terminal: false });
      return jsonResponse(200, {
        jobId: "prv_fail",
        status: "failed",
        terminal: true,
        error: { code: -32603, message: "Transaction reverted" },
      });
    });
    const prover = new StarkscanProver({ apiKey: "k", fetchImpl });
    await expect(
      prover.proveTransaction({ block_id: { block_number: 1 }, transaction: {} }),
    ).rejects.toThrow(/failed|reverted/i);
  });

  it("maps 401 to an auth error (never fabricates a proof)", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(401, { message: "Unauthorized" }));
    const prover = new StarkscanProver({ apiKey: "bad", fetchImpl });
    const err = await prover
      .proveTransaction({ block_id: { block_number: 1 }, transaction: {} })
      .catch((e) => e as StarkscanProverError);
    expect(err).toBeInstanceOf(StarkscanProverError);
    expect(err.kind).toBe("auth");
  });

  it("maps 404 to dormant (relay not enabled) and 429 to budget", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(404, {}));
    const prover = new StarkscanProver({ apiKey: "k", fetchImpl });
    const err = await prover.proveTransaction({ block_id: { block_number: 1 }, transaction: {} }).catch((e) => e);
    expect((err as StarkscanProverError).kind).toBe("dormant");

    const fetch429 = makeFetch(async () => jsonResponse(429, {}));
    const prover429 = new StarkscanProver({ apiKey: "k", fetchImpl: fetch429 });
    const err429 = await prover429
      .proveTransaction({ block_id: { block_number: 1 }, transaction: {} })
      .catch((e) => e);
    expect((err429 as StarkscanProverError).kind).toBe("budget");
  });

  it("rejects construction without an API key", () => {
    expect(() => new StarkscanProver({ apiKey: "" })).toThrow(/not configured/i);
  });

  it("checkAuth classifies 401 as unauthenticated (auth wrong), not 403 (scope wrong)", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(401, {}));
    const prover = new StarkscanProver({ apiKey: "dummy", fetchImpl });
    const result = await prover.checkAuth();
    expect(result.kind).toBe("unauthenticated");
    expect(result.code).toBe(401);
  });

  it("checkAuth classifies 403 as forbidden (auth valid but no prove scope)", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(403, {}));
    const prover = new StarkscanProver({ apiKey: "scoped-but-wrong", fetchImpl });
    const result = await prover.checkAuth();
    expect(result.kind).toBe("forbidden");
    expect(result.code).toBe(403);
  });

  it("checkAuth treats a validation-layer 400 as authenticated (reached the relay with a valid key)", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse(400, {}));
    const prover = new StarkscanProver({ apiKey: "valid", fetchImpl });
    const result = await prover.checkAuth();
    expect(result.kind).toBe("authenticated");
  });

  it("checkAuth maps 404 to dormant and unreachable network to unreachable", async () => {
    const fetch404 = makeFetch(async () => jsonResponse(404, {}));
    const p404 = new StarkscanProver({ apiKey: "k", fetchImpl: fetch404 });
    expect((await p404.checkAuth()).kind).toBe("dormant");

    const fetchNet = makeFetch(async () => {
      throw new Error("network down");
    });
    const pNet = new StarkscanProver({ apiKey: "k", fetchImpl: fetchNet });
    expect((await pNet.checkAuth()).kind).toBe("unreachable");
  });
});
