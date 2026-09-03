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
});