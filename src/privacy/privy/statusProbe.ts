/**
 * @file statusProbe.ts
 * @description Small resilient-probe helpers for STRK20 on-chain status detection.
 *
 * The privacy pool's discovery service (`/v1/sync/preflight_check`) can transiently return
 * HTTP 503 when its backing RPC/indexer is briefly unavailable. These helpers bound that
 * failure: retry a probe a few times with exponential backoff, and only throw once the
 * retries are exhausted (so callers can surface "unknown/error" instead of "disabled").
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `probe` up to `attempts` times with exponential backoff, returning the first success.
 * Re-throws the last error once all attempts are exhausted. `attempts` is always >= 1.
 */
export async function withRetry<T>(
  probe: () => Promise<T>,
  attempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await probe();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
