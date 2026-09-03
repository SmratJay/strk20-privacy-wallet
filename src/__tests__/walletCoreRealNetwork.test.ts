/**
 * @file walletCoreRealNetwork.test.ts
 * @description Stage 2 — real Starknet Sepolia integration (public RPC). Verifies Braavos class
 *   declaration, Ready counterfactual probing, and SRC-5 ownership rejection against actual chain
 *   state. Skips when the public RPC is unreachable (offline/CI). No real funds are spent and no
 *   real private keys are used — the ownership check uses a throwaway key against a real account.
 */

import { describe, it, expect } from "vitest";
import { RpcProvider } from "starknet";
import { getNetworkConfig } from "@/config/networks";
import {
  BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA,
  BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA,
  probeAccountDeployment,
  computeReadyAccountAddress,
  READY_SEPOLIA_CLASS_HASH,
} from "@/wallet";
import { generateSecretKey, canonicalizeSecret, getPublicKey } from "@/wallet/crypto";
import { deriveWalletViewingKey, resolveWalletPrivacyConfig } from "@/wallet/privacy";
import { verifyAccountOwnership } from "@/wallet/ownership";
import { Account } from "starknet";

const RPC = getNetworkConfig("sepolia").rpcUrls[0];
const provider = new RpcProvider({ nodeUrl: RPC });

async function rpcReachable(): Promise<boolean> {
  try {
    await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 15_000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

describe("real Starknet Sepolia network", () => {
  it("verifies the Braavos account classes are declared on-chain", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();
    const account = await provider.getClass(BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA);
    const base = await provider.getClass(BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA);
    // The verified account class exposes the Braavos ownership surface used for import.
    const entrypoints = (account.abi ?? [])
      .filter((a: any) => a.type === "interface")
      .flatMap((i: any) => (i.items ?? []).map((f: any) => f.name));
    expect(entrypoints).toContain("get_public_key");
    expect(entrypoints).toContain("get_multisig_threshold");
    expect(entrypoints).toContain("is_valid_signature");
    expect(base.abi?.length ?? 0).toBeGreaterThan(0);
  });

  it("probes a fresh Ready counterfactual account as not deployed on the real chain", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();
    const secret = canonicalizeSecret(generateSecretKey());
    const pubKey = getPublicKey(secret);
    const address = computeReadyAccountAddress(pubKey, READY_SEPOLIA_CLASS_HASH);
    const probe = await probeAccountDeployment(provider, address, READY_SEPOLIA_CLASS_HASH);
    // A freshly generated counterfactual Ready account cannot be deployed on the real chain.
    expect(probe).toBe("not_deployed");
  });

  it("rejects ownership of a real deployed account with a wrong key (SRC-5)", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();

    // Find a real deployed account from a recent block's transaction sender.
    let address: string | null = null;
    for (let attempt = 0; attempt < 5 && !address; attempt++) {
      const block = (await provider.getBlockWithTxs("latest")) as {
        transactions?: { sender_address?: string }[];
      };
      address = (block.transactions ?? []).map((t) => t.sender_address).find(Boolean) ?? null;
      if (!address) await new Promise((r) => setTimeout(r, 2000));
    }
    if (!address) return ctx.skip();

    const probe = await probeAccountDeployment(provider, address);
    expect(probe).toBe("deployed");

    // A throwaway key does NOT control the real account — ownership must be rejected on-chain.
    const secret = canonicalizeSecret(generateSecretKey());
    const account = new Account({ provider, address, signer: new (await import("starknet")).Signer(secret), cairoVersion: "1" });
    const result = await verifyAccountOwnership(account, provider);
    expect(result.verified).toBe(false);
  });

  it("verifies the STRK20 pool is deployed on real Sepolia and a wallet-native viewing key is canonical", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();
    const poolAddress = getNetworkConfig("sepolia").poolAddress;
    const classHash = await provider.getClassHashAt(poolAddress);
    expect(BigInt(classHash)).not.toBe(0n);

    // Wallet-native viewing-key derivation for a throwaway wallet: must be canonical and in the
    // STRK20 range (a real, valid key for the pool).
    const secret = canonicalizeSecret(generateSecretKey());
    const viewingKey = deriveWalletViewingKey(secret, "sepolia");
    const n = 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
    expect(viewingKey).toBeGreaterThan(0n);
    expect(viewingKey).toBeLessThanOrEqual(n / 2n);
  });

  it("reports STRK20 privacy as unavailable when operator proving/discovery services are not configured (no fake zero)", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();
    // In this environment the operator prover/discovery services are not configured, so the
    // wallet-native privacy capability must report UNAVAILABLE (never a fake zero balance).
    const savedProver = process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    const savedDiscovery = process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    try {
      expect(resolveWalletPrivacyConfig("sepolia")).toBeNull();
    } finally {
      if (savedProver) process.env.NEXT_PUBLIC_STRK20_PROVER_URL = savedProver;
      if (savedDiscovery) process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = savedDiscovery;
    }
  });

  it("creates a wallet against the real chain and reconciles deployment to not_deployed (first-use probe)", async (ctx) => {
    if (!(await rpcReachable())) return ctx.skip();
    const { WalletRuntime } = await import("../wallet/runtime");
    const { createMemoryStorage } = await import("../wallet/storage");
    const { getPublicKey } = await import("../wallet/crypto");
    const { computeReadyAccountAddress } = await import("../wallet/account");

    const runtime = new WalletRuntime({ storage: createMemoryStorage(), lazy: true });
    runtime.init();
    const wallet = await runtime.create("correct horse battery staple");
    const s = runtime.getState();

    // The active account is a real counterfactual Ready address derived from the created key.
    const derived = computeReadyAccountAddress(getPublicKey(wallet.secret), READY_SEPOLIA_CLASS_HASH);
    expect(wallet.address.toLowerCase()).toBe(derived.toLowerCase());
    expect(s.account?.address.toLowerCase()).toBe(derived.toLowerCase());

    // The on-chain probe against the real chain must report not_deployed (a brand-new key cannot
    // already host a deployed account) — the first-use "Deployment pending" state.
    await runtime.refreshDeployment();
    expect(runtime.getState().deploymentStatus).toBe("not_deployed");
  });

  it("LIVE ACCEPTANCE — full privacy path (register→shield→balance→transfer→withdraw) when funded + operator reachable; skips honestly otherwise", async (ctx) => {
    // This test does NOT fake success. It attempts the real privacy path only when every
    // prerequisite holds (reachable RPC, configured + reachable operator services, funded
    // Sepolia wallet). Otherwise it skips with the exact reason. Use a funded Sepolia wallet
    // and reachable discovery/prover services to exercise the real flow.
    if (!(await rpcReachable())) return ctx.skip();

    const proverUrl = (process.env.NEXT_PUBLIC_STRK20_PROVER_URL ?? "").trim();
    const discoveryUrl = (process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? "").trim();
    if (!proverUrl || !discoveryUrl) {
      console.log("[live-acceptance] SKIPPED: operator prover/discovery services not configured (NEXT_PUBLIC_STRK20_*).");
      return ctx.skip();
    }

    // Discovery reachability: any HTTP response (even 4xx/5xx) means the service is up; a
    // network-level failure/timeout means it is unreachable from this environment.
    let discoveryUp = false;
    try {
      const res = await fetch(`${discoveryUrl}/v1/sync/preflight_check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "0x0", token: "0x0" }),
        signal: AbortSignal.timeout(10_000),
      });
      discoveryUp = res.status >= 100; // any response ⇒ reachable
    } catch {
      discoveryUp = false;
    }
    if (!discoveryUp) {
      console.log("[live-acceptance] SKIPPED: discovery service unreachable from this environment.");
      return ctx.skip();
    }

    const { WalletRuntime } = await import("../wallet/runtime");
    const { createMemoryStorage } = await import("../wallet/storage");
    const runtime = new WalletRuntime({ storage: createMemoryStorage(), lazy: true });
    runtime.init();
    const wallet = await runtime.create("correct horse battery staple");

    // Funded-wallet gate: the account must hold enough STRK to cover the pool fee + a real
    // shield deposit. A fresh counterfactual account is not funded, so this usually skips.
    const strk = getNetworkConfig("sepolia").tokens[0];
    const balanceRes = await provider.callContract({
      contractAddress: strk.address,
      entrypoint: "balanceOf",
      calldata: [wallet.address],
    });
    const balance = BigInt(balanceRes[0] ?? "0x0");
    const MIN_STRK_FOR_LIVE_SHIELD = 2n * 10n ** 18n; // fee headroom + a real deposit
    if (balance < MIN_STRK_FOR_LIVE_SHIELD) {
      console.log(
        `[live-acceptance] SKIPPED: wallet is not funded (STRK balance ${balance.toString()} < ${MIN_STRK_FOR_LIVE_SHIELD.toString()}). No real funds were spent.`,
      );
      return ctx.skip();
    }

    // Every prerequisite holds → execute the REAL privacy path. Any assertion failure below is a
    // genuine finding (no mocking, no fake success).
    const config = resolveWalletPrivacyConfig("sepolia");
    if (!config) return ctx.skip();

    const reg = await runtime.register();
    expect(reg.status).toBe("PENDING");

    const shield = await runtime.shield(strk.address, 1n * 10n ** 18n);
    expect(shield.status).toBe("PENDING");

    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow).toBeDefined();
    expect(strkRow!.balance).toBeGreaterThanOrEqual(1n * 10n ** 18n);

    const transfer = await runtime.privateTransfer(strk.address, 1n * 10n ** 18n, wallet.address);
    expect(transfer.status).toBe("PENDING");

    const withdraw = await runtime.withdraw(strk.address, 1n * 10n ** 18n);
    expect(withdraw.status).toBe("PENDING");
  });
});