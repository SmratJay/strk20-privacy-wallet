/**
 * @file statusProbe.test.ts
 * @description Resilient probe for STRK20 privacy-status detection. The discovery service can
 * transiently return 503 (preflight_check), so status detection must retry with bounded backoff
 * and only throw once exhausted — callers then surface "error/unknown" (NOT "disabled").
 */

import { describe, it, expect, vi } from "vitest";
import { withRetry, sleep } from "../privacy/privy/statusProbe";

describe("withRetry", () => {
  it("returns the value on the first successful attempt", async () => {
    const probe = vi.fn(async () => "registered");
    await expect(withRetry(probe, 3, 0)).resolves.toBe("registered");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("recovers after a transient failure (503) and returns the recovered value", async () => {
    const probe = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Indexer API /v1/sync/preflight_check failed (503)"))
      .mockResolvedValueOnce("registered");
    await expect(withRetry(probe, 3, 0)).resolves.toBe("registered");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("throws only after exhausting all attempts (so callers surface error, not disabled)", async () => {
    const probe = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("Indexer API /v1/sync/preflight_check failed (503)"));
    await expect(withRetry(probe, 3, 0)).rejects.toThrow(/503/);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("respects attempts=1 (no retry)", async () => {
    const probe = vi.fn(async () => "unregistered");
    await expect(withRetry(probe, 1, 0)).resolves.toBe("unregistered");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("sleep", () => {
  it("resolves after the requested delay", async () => {
    const started = Date.now();
    await sleep(10);
    expect(Date.now() - started).toBeGreaterThanOrEqual(8);
  });
});
