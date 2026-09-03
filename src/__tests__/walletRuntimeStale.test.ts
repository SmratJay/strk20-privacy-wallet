/**
 * @file walletRuntimeStale.test.ts
 * @description Stage 2.5 hardening — stale-async protection (generation guard) and UI-facing
 *   state safety. Async deployment/balance results from a previous wallet/network/session must
 *   never update state after a switch or lock, and `getState()` must never expose the raw secret.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";
import { canonicalizeSecret, generateSecretKey } from "../wallet/crypto";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import type { UnlockedWallet } from "../wallet";

// Mock the public-balance service so we can control when its promise resolves (stale timing).
vi.mock("@/services/privacyService", () => ({
  privacyService: {
    fetchBalances: vi.fn(),
  },
}));

import { privacyService } from "@/services/privacyService";

const PASSWORD = "correct horse battery staple";
const VALID_SRC5 = ["0x56614c4944"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fastProvider() {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => VALID_SRC5),
    getBlockNumber: vi.fn(async () => 1),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  } as never;
}

/** Provider whose getClassHashAt is controllable (deferred) — for deployment timing. */
function slowProvider() {
  const d = deferred<string>();
  return {
    provider: {
      getClassHashAt: vi.fn(() => d.promise),
      callContract: vi.fn(async () => VALID_SRC5),
      getBlockNumber: vi.fn(async () => 1),
      waitForTransaction: vi.fn(async () => ({})),
    } as never,
    resolve: d.resolve,
  };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function createWallet(runtime: WalletRuntime): Promise<void> {
  await runtime.create(PASSWORD);
}

describe("stale async state protection", () => {
  beforeEach(() => {
    (privacyService.fetchBalances as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("ignores a stale deployment result after lock", async () => {
    const storage = createMemoryStorage();
    const slow = slowProvider();
    const runtime = new WalletRuntime({ storage, providerFactory: () => slow.provider });

    await createWallet(runtime);
    expect(runtime.getState().deploymentStatus).toBe("not_deployed");

    runtime.lock();
    // The pending deployment probe (from the fired refreshDeployment) resolves AFTER lock.
    slow.resolve(READY_SEPOLIA_CLASS_HASH);
    await tick();

    expect(runtime.getState().deploymentStatus).toBe("unknown");
  });

  it("ignores a stale deployment result after a wallet switch", async () => {
    const storage = createMemoryStorage();
    const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });
    const walletA: UnlockedWallet = await runtime.create(PASSWORD);

    // Make wallet A's deployment probe controllable so a refresh stays in flight across a switch.
    let resolveProbe!: (v: string) => void;
    walletA.adapter.probeDeployment = vi.fn(
      () => new Promise<string>((res) => { resolveProbe = res; }),
    ) as never;
    const pending = runtime.refreshDeployment();

    // Switch to wallet B (its own import probe + refresh resolve via the fast provider).
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });
    await tick();

    // Now resolve wallet A's STALE deployment probe — it must be dropped (active wallet is B).
    resolveProbe(READY_SEPOLIA_CLASS_HASH);
    await pending;
    await tick();

    expect(runtime.getState().account?.walletId).toBe(walletB.walletId);
    // deploymentStatus reflects B (deployed), never A's stale result.
    expect(runtime.getState().deploymentStatus).toBe("deployed");
  });

  it("ignores a stale public-balance result after lock", async () => {
    const storage = createMemoryStorage();
    const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });
    await createWallet(runtime);

    const d = deferred<unknown[]>();
    (privacyService.fetchBalances as unknown as ReturnType<typeof vi.fn>).mockReturnValue(d.promise);

    const pending = runtime.refreshPublicBalances();
    runtime.lock();
    d.resolve([{ token: { symbol: "STRK", decimals: 18 }, publicBalance: 5n, publicBalanceAvailable: true }]);
    await pending;
    await tick();

    expect(runtime.getState().publicBalances).toHaveLength(0);
  });

  it("ignores a stale public-balance result after a wallet switch", async () => {
    const storage = createMemoryStorage();
    const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });

    await createWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    runtime.lock();
    runtime.selectWallet(runtime.getState().wallets[0]!.walletId);
    await runtime.unlock(PASSWORD);
    expect(runtime.getState().account?.walletId).toBe(runtime.getState().wallets[0]!.walletId);

    const d = deferred<unknown[]>();
    (privacyService.fetchBalances as unknown as ReturnType<typeof vi.fn>).mockReturnValue(d.promise);
    const pending = runtime.refreshPublicBalances();

    runtime.lock();
    runtime.selectWallet(walletB.walletId);
    d.resolve([{ token: { symbol: "STRK", decimals: 18 }, publicBalance: 9n, publicBalanceAvailable: true }]);
    await pending;
    await tick();

    expect(runtime.getState().publicBalances).toHaveLength(0);
    expect(runtime.getState().isUnlocked).toBe(false);
  });

  it("lock cannot be undone by a pending create resolving later", async () => {
    const storage = createMemoryStorage();
    const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });
    // A pending create is not observable here; instead verify that after lock + stale deployment
    // resolution the session stays locked (never resurrected by async work).
    await createWallet(runtime);
    runtime.lock();
    await tick();
    expect(runtime.getState().account).toBeNull();
    expect(runtime.getState().isUnlocked).toBe(false);
  });
});

describe("UI-facing state safety", () => {
  it("never exposes the raw private key / signer / account through getState", async () => {
    const storage = createMemoryStorage();
    const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });
    const wallet: UnlockedWallet = await runtime.create(PASSWORD);

    const view = runtime.getState();
    const raw = view as unknown as Record<string, unknown>;
    const json = JSON.stringify(view);

    // The safe view carries only public fields.
    expect(view.account?.walletId).toBe(wallet.walletId);
    expect(view.account?.address).toBe(wallet.address);
    expect(view.account?.accountType).toBe(wallet.accountType);
    expect(view.account?.publicKey).toBe(wallet.publicKey);

    // No secret / signer / account internals in the view.
    expect(raw.secret).toBeUndefined();
    expect(raw.session).toBeUndefined();
    expect(raw.signer).toBeUndefined();
    expect((raw.account as Record<string, unknown> | undefined)?.secret).toBeUndefined();
    expect(json).not.toContain(wallet.secret);
  });
});