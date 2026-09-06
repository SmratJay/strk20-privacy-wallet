/**
 * @file privacyHub.test.ts
 * @description Phase 5 — Cross-Chain PrivacyHub orchestration layer. Behavior-first coverage of the
 *   typed hub intent + route registry + provider abstraction + orchestration service, with the
 *   provider MOCKED (no real NEAR HTTP, no STRK20 SDK, no real funds). Also covers the
 *   `NearIntentProvider` translation against a structural fake `NearIntentAdapter`, phase
 *   normalization, and the thin WalletRuntime bridge (locked-wallet rejection).
 */

import { describe, it, expect, vi } from "vitest";

import {
  validatePrivacyHubIntent,
  computeHubMinOutput,
  PrivacyHubError,
  nearPhaseToHubPhase,
  PrivacyHub,
  PRIVACY_HUB_ROUTES,
  resolvePrivacyHubRoute,
  privacyHubRouteById,
  routeHasPrivacyCapability,
  NearIntentProvider,
  ConfidentialIntentProvider,
  confidentialIntentAvailability,
  type CrossChainProvider,
  type PrivacyHubIntent,
  type PrivacyHubQuote,
  type PrivacyHubPrepared,
  type PrivacyHubReceipt,
  type PrivacyHubStatus,
  type PrivacyHubReadiness,
} from "../features/privacy-hub";

import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";

const DEST = "0x742d35cc6634c0532925a3b8d84b2021f90a51a3";

function validIntent(overrides: Partial<PrivacyHubIntent> = {}): PrivacyHubIntent {
  return {
    sourceChain: "starknet",
    sourceAsset: "strk",
    sourceAmount: 100n,
    destinationChain: "base",
    destinationAsset: "usdc",
    destinationAddress: DEST,
    slippageBps: 100,
    appName: "orrange",
    nonce: 0n,
    ...overrides,
  };
}

/** A fake provider with recorded calls, to test the hub's routing/forwarding without real I/O. */
function makeFakeProvider(): CrossChainProvider & { calls: string[] } {
  const calls: string[] = [];
  const quote: PrivacyHubQuote = {
    route: "STRK (Starknet) → USDC (Base)",
    provider: "near-intents",
    sourceChain: "starknet",
    sourceAsset: "strk",
    sourceAmount: 100n,
    destinationChain: "base",
    destinationAsset: "usdc",
    destinationAddress: DEST,
    amountOut: 1_000_000n,
    minAmountOut: 990_000n,
    refundFee: 0n,
    withdrawFee: 0n,
    timeEstimate: 30,
    deadline: new Date(Date.now() + 3600e3).toISOString(),
    slippageBps: 100,
  };
  const prepared: PrivacyHubPrepared = {
    route: "STRK (Starknet) → USDC (Base)",
    provider: "near-intents",
    reference: "0xdeposit",
    sourceAmount: 100n,
    amountOut: 1_000_000n,
    minAmountOut: 990_000n,
    destinationAddress: DEST,
    providerPayload: { depositAddress: "0xdeposit" },
  };
  const receipt: PrivacyHubReceipt = {
    route: "STRK (Starknet) → USDC (Base)",
    provider: "near-intents",
    reference: "0xdeposit",
    phase: "success",
    sourceAmount: 100n,
    destinationAddress: DEST,
    amountOut: 1_000_000n,
    transactionHash: "0xsource",
    destinationTxHashes: ["0xbase"],
    refundedAmount: 0n,
    refundReason: null,
  };
  const status: PrivacyHubStatus = {
    provider: "near-intents",
    reference: "0xdeposit",
    phase: "success",
    terminal: true,
    settled: true,
    amountOut: 1_000_000n,
    refundedAmount: 0n,
    refundReason: null,
    destinationTxHashes: ["0xbase"],
  };
  return {
    id: "near-intents",
    calls,
    quote: vi.fn(async () => {
      calls.push("quote");
      return quote;
    }),
    prepare: vi.fn(async (_i, q) => {
      calls.push("prepare");
      void q;
      return prepared;
    }),
    execute: vi.fn(async (_i, p) => {
      calls.push("execute");
      void p;
      return receipt;
    }),
    status: vi.fn(async () => {
      calls.push("status");
      return status;
    }),
    readiness: vi.fn(async (): Promise<PrivacyHubReadiness> => {
      calls.push("readiness");
      return { provider: "near-intents", ready: true, checks: [], reason: null };
    }),
  };
}

describe("typed hub intent + route model", () => {
  it("accepts a well-formed hub intent and rejects malformed ones", () => {
    expect(validatePrivacyHubIntent(validIntent())).toBeNull();
    expect(validatePrivacyHubIntent(null)).not.toBeNull();
    expect(validatePrivacyHubIntent({})).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), sourceChain: "ethereum" })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), sourceAsset: "eth" })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), sourceAmount: 0n })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), destinationChain: "ethereum" })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), destinationAsset: "eth" })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), destinationAddress: "0x1234" })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), slippageBps: 10001 })).not.toBeNull();
    expect(validatePrivacyHubIntent({ ...validIntent(), expiry: Date.now() - 1 })).not.toBeNull();
  });

  it("resolves the single supported route (and rejects unsupported ones)", () => {
    expect(resolvePrivacyHubRoute("starknet", "strk", "base", "usdc")?.provider).toBe("near-intents");
    expect(resolvePrivacyHubRoute("base", "usdc", "starknet", "strk")).toBeNull();
    expect(privacyHubRouteById("starknet-strk-to-base-usdc")?.addressKind).toBe("evm");
    expect(privacyHubRouteById("does-not-exist")).toBeNull();
  });

  it("derives min-output with integer math", () => {
    expect(computeHubMinOutput(1_000_000n, 0)).toBe(1_000_000n);
    expect(computeHubMinOutput(1_000_000n, 100)).toBe(990_000n);
    expect(computeHubMinOutput(1_000_000n, 10_000)).toBe(0n);
    expect(() => computeHubMinOutput(1n, -1)).toThrow(PrivacyHubError);
  });
});

describe("phase normalization", () => {
  it("collapses provider phases into the normalized hub lifecycle", () => {
    expect(nearPhaseToHubPhase("idle")).toBe("idle");
    expect(nearPhaseToHubPhase("quoting")).toBe("quoting");
    expect(nearPhaseToHubPhase("preparing")).toBe("preparing");
    expect(nearPhaseToHubPhase("intent-created")).toBe("preparing");
    expect(nearPhaseToHubPhase("awaiting-source-deposit")).toBe("funding");
    expect(nearPhaseToHubPhase("source-confirming")).toBe("funding");
    expect(nearPhaseToHubPhase("solver-executing")).toBe("processing");
    expect(nearPhaseToHubPhase("destination-pending")).toBe("destination-pending");
    expect(nearPhaseToHubPhase("success")).toBe("success");
    expect(nearPhaseToHubPhase("failed")).toBe("failed");
    expect(nearPhaseToHubPhase("refunded")).toBe("refunded");
    expect(nearPhaseToHubPhase("unknown")).toBe("unknown");
  });
});

describe("provider selection + forwarding", () => {
  it("routes to the registered provider and forwards the lifecycle", async () => {
    const fake = makeFakeProvider();
    const hub = new PrivacyHub({ providers: { "near-intents": fake } });

    const quote = await hub.quote(validIntent());
    expect(quote.provider).toBe("near-intents");
    expect(fake.calls).toContain("quote");

    const prepared = await hub.prepare(validIntent(), quote);
    expect(prepared.reference).toBe("0xdeposit");

    const receipt = await hub.execute(validIntent(), prepared);
    expect(receipt.phase).toBe("success");
    expect(fake.calls).toEqual(["quote", "prepare", "execute"]);

    const status = await hub.status("0xdeposit");
    expect(status.settled).toBe(true);

    const readiness = await hub.readiness(validIntent());
    expect(readiness.ready).toBe(true);
  });

  it("rejects an unsupported route before any provider call", async () => {
    const fake = makeFakeProvider();
    const hub = new PrivacyHub({ providers: { "near-intents": fake } });
    await expect(hub.quote({ ...validIntent(), destinationChain: "solana" as never })).rejects.toThrow(
      /invalid cross-chain intent|cannot read/i,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects an expired intent before any provider call", async () => {
    const fake = makeFakeProvider();
    const hub = new PrivacyHub({ providers: { "near-intents": fake } });
    await expect(hub.quote(validIntent({ expiry: Date.now() - 1000 }))).rejects.toThrow(/expired/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("throws when no provider is registered for the route", async () => {
    const hub = new PrivacyHub({ providers: {} });
    await expect(hub.quote(validIntent())).rejects.toThrow(/no provider registered/i);
  });
});

describe("NearIntentProvider (adapter wrapper translation)", () => {
  it("forwards quote/prepare/execute/status to the adapter and normalizes phases", async () => {
    const adapter = {
      quote: vi.fn(async () => ({
        route: "STRK (Starknet) → USDC (Base)",
        sourceChain: "starknet",
        sourceAsset: "strk",
        sourceAmount: 100n,
        destinationChain: "base",
        destinationAsset: "usdc",
        destinationAddress: DEST,
        amountOut: 1_000_000n,
        minAmountOut: 990_000n,
        refundFee: 0n,
        withdrawFee: 0n,
        timeEstimate: 30,
        deadline: "t",
        slippageBps: 100,
      })),
      createIntent: vi.fn(async () => ({
        route: "STRK (Starknet) → USDC (Base)",
        sourceChain: "starknet",
        sourceAsset: "strk",
        sourceAmount: 100n,
        destinationChain: "base",
        destinationAsset: "usdc",
        destinationAddress: DEST,
        amountOut: 1_000_000n,
        minAmountOut: 990_000n,
        refundFee: 0n,
        withdrawFee: 0n,
        timeEstimate: 30,
        deadline: "t",
        slippageBps: 100,
        depositAddress: "0xdeposit",
        depositAddressDeadline: "t2",
        intentId: "intent-1",
        sourceTokenAddress: "0xtoken",
      })),
      execute: vi.fn(async (_i, _p, opts) => {
        opts?.onPhase?.({ phase: "solver-executing", status: "PROCESSING", amountOut: 1_000_000n });
        return {
          status: "SUCCESS",
          intentId: "intent-1",
          depositAddress: "0xdeposit",
          sourceChain: "starknet",
          destinationChain: "base",
          sourceAsset: "strk",
          sourceAmount: 100n,
          destinationAsset: "usdc",
          destinationAddress: DEST,
          amountOut: 1_000_000n,
          shadowAddress: "0xshadow",
          commitment: "0xcommit",
          transactionHash: "0xsource",
          nearTxHashes: ["0xnear"],
          destinationChainTxHashes: ["0xbase"],
          refundedAmount: 0n,
          refundReason: null,
        };
      }),
      status: vi.fn(async () => ({
        code: "PROCESSING",
        depositAddress: "0xdeposit",
        intentHashes: [],
        nearTxHashes: [],
        originChainTxHashes: [],
        destinationChainTxHashes: ["0xbase"],
        amountIn: 100n,
        amountOut: 1_000_000n,
        refundedAmount: 0n,
        refundReason: null,
        terminal: false,
        settled: false,
      })),
    };

    const provider = new NearIntentProvider(adapter as never);
    const hub = new PrivacyHub({ providers: { "near-intents": provider } });

    const quote = await hub.quote(validIntent());
    expect(quote.amountOut).toBe(1_000_000n);
    expect(quote.providerPayload).toBeDefined();

    const prepared = await hub.prepare(validIntent(), quote);
    expect(prepared.reference).toBe("0xdeposit");

    const phases: string[] = [];
    const receipt = await hub.execute(validIntent(), prepared, { onPhase: (p) => phases.push(p) });
    expect(receipt.phase).toBe("success");
    expect(receipt.destinationTxHashes).toEqual(["0xbase"]);
    expect(receipt.transactionHash).toBe("0xsource");
    expect(phases).toContain("processing"); // near "solver-executing" → hub "processing"

    const status = await hub.status("0xdeposit");
    expect(status.phase).toBe("processing"); // PROCESSING → processing, terminal=false, settled=false
  });
});

describe("WalletRuntime privacy-hub bridge (thin)", () => {
  it("rejects hub calls when the wallet is locked", async () => {
    const runtime = new WalletRuntime({ storage: createMemoryStorage(), network: "sepolia" });
    await expect(runtime.quotePrivacyHub(validIntent())).rejects.toThrow(/locked/i);
    await expect(runtime.executePrivacyHub(validIntent())).rejects.toThrow(/locked/i);
    await expect(runtime.getPrivacyHubStatus("0xdeposit")).rejects.toThrow(/locked/i);
  });
});

describe("confidential execution provider boundary (seam only)", () => {
  it("declares the current route's privacy capabilities honestly (no over-claim)", () => {
    const route = resolvePrivacyHubRoute("starknet", "strk", "base", "usdc");
    expect(route).not.toBeNull();
    expect(routeHasPrivacyCapability(route!, "source-private")).toBe(true);
    expect(routeHasPrivacyCapability(route!, "destination-public")).toBe(true);
    expect(routeHasPrivacyCapability(route!, "public-settlement")).toBe(true);
    expect(routeHasPrivacyCapability(route!, "confidential-execution")).toBe(false);
    expect(routeHasPrivacyCapability(route!, "selective-disclosure")).toBe(false);
  });

  it("keeps the public route resolving to near-intents (confidential provider never auto-selected)", () => {
    expect(resolvePrivacyHubRoute("starknet", "strk", "base", "usdc")?.provider).toBe("near-intents");
    // No registered route targets the confidential provider.
    expect(PRIVACY_HUB_ROUTES.some((r) => r.provider === "confidential-intents")).toBe(false);
  });

  it("reports confidential execution as unavailable (no fake quote/settlement)", () => {
    const availability = confidentialIntentAvailability();
    expect(availability.available).toBe(false);
    expect(availability.requiresUserSessionAuth).toBe(true);
    expect(availability.starknetSigningSupported).toBe(false);
    expect(availability.supportedLevels).toEqual(["basic", "advanced"]);

    const provider = new ConfidentialIntentProvider();
    expect(provider.id).toBe("confidential-intents");
    expect(provider.availability.available).toBe(false);
  });

  it("the confidential provider seam fails explicitly and never fabricates results", async () => {
    const provider = new ConfidentialIntentProvider();
    await expect(provider.quote(validIntent())).rejects.toThrow(/confidential execution is unavailable/i);
    await expect(provider.prepare(validIntent(), null)).rejects.toThrow(/unavailable/i);
    const readiness = await provider.readiness(validIntent());
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/user-session authentication/i);
  });

  it("never registers the confidential provider, so there is no accidental fallback", async () => {
    const route = resolvePrivacyHubRoute("starknet", "strk", "base", "usdc")!;
    const hub = new PrivacyHub({ providers: { "near-intents": makeFakeProvider() } });
    // The resolved route points at near-intents, which IS registered → works.
    const quote = await hub.quote(validIntent());
    expect(quote.provider).toBe("near-intents");
    // There is no confidential route, so provideFor can never select confidential-intents.
    expect(route.provider).toBe("near-intents");
  });
});
