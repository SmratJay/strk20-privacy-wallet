/**
 * @file privateExecutionLiveAcceptance.test.ts
 * @description Phase 1 REAL Sepolia acceptance gate for the private-execution primitive.
 *
 *   Full live path (no mocks):
 *     deployer (funded) → funds a FRESH Wallet Core Ready wallet → DEPLOY_ACCOUNT → 10-block
 *     proving maturity → STRK20 register → shield → private balance discovery → PrivateIdentity →
 *     StarknetPrivateExecutor (runtime.executePrivate) → real Sepolia tx → success → verify the
 *     application-side result on the PrivateExecutionProbe (execution count + received STRK).
 *
 *   The funded deployer wallet itself was registered under a legacy viewing-key derivation in a
 *   prior phase, so a FRESH wallet is used for the wallet-native STRK20 path (it has no prior
 *   registration). The deployer provides the funds.
 *
 *   Requires: `RUN_LIVE_ACCEPTANCE=1`, deployments/deployer_account.json (funded), a reachable
 *   STRK20 prover + discovery (NEXT_PUBLIC_STRK20_*), and the deployed probe address
 *   (NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA). Skips honestly otherwise — never fakes success.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Account, RpcProvider, num } from "starknet";
import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";

const PASSWORD = "correct horse battery staple";

function deployerWallet(): { address: string; privateKey: string } | null {
  const file = join(__dirname, "..", "..", "deployments", "deployer_account.json");
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { accountAddress?: string; privateKey?: string };
    if (!data.accountAddress || !data.privateKey) return null;
    return { address: data.accountAddress, privateKey: data.privateKey };
  } catch {
    return null;
  }
}

describe("PRIVATE EXECUTION — real Sepolia acceptance", () => {
  it("runs the full live private-execution path and verifies the app-side result", async (ctx) => {
    if (process.env.RUN_LIVE_ACCEPTANCE !== "1") {
      console.log("[live-acceptance] SKIPPED: set RUN_LIVE_ACCEPTANCE=1 to run the funded live gate.");
      return ctx.skip();
    }
    const deployer = deployerWallet();
    if (!deployer) {
      console.log("[live-acceptance] SKIPPED: deployments/deployer_account.json (funded wallet) not present.");
      return ctx.skip();
    }
    const proverUrl = (process.env.NEXT_PUBLIC_STRK20_PROVER_URL ?? "").trim();
    const discoveryUrl = (process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? "").trim();
    const probe = (process.env.NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA ?? "").trim();
    if (!proverUrl || !discoveryUrl || !probe) {
      console.log("[live-acceptance] SKIPPED: operator prover/discovery or probe address not configured.");
      return ctx.skip();
    }
    let discoveryUp = false;
    try {
      const res = await fetch(`${discoveryUrl}/health`, { signal: AbortSignal.timeout(10_000) });
      discoveryUp = res.status >= 100;
    } catch {
      discoveryUp = false;
    }
    if (!discoveryUp) {
      console.log("[live-acceptance] SKIPPED: discovery service unreachable from this environment.");
      return ctx.skip();
    }

    const rpc = (process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim() || undefined;
    const provider = new RpcProvider({ nodeUrl: rpc ?? "https://starknet-sepolia-rpc.publicnode.com" });
    const deployerAcct = new Account({
      provider,
      address: deployer.address,
      signer: deployer.privateKey,
    });

    // 0. Create a FRESH Wallet Core Ready wallet (counterfactual, unregistered — clean STRK20 path).
    const runtime = new WalletRuntime({ storage: createMemoryStorage(), lazy: true });
    runtime.init();
    const wallet = await runtime.create(PASSWORD);
    console.log(`[live-acceptance] fresh wallet ${wallet.address}`);

    const strk = (await import("../config/networks")).getNetworkConfig("sepolia").tokens[0];

    // 1. Deployer funds the fresh wallet (public STRK transfer) — enough to cover the REAL STRK20
    //    proof gas (STARK proofs are gas-heavy; the adapter's bounded resource fallback caps at
    //    ~78 STRK, so the account balance must cover the caps for the node's validation).
    const funding = 200n * 10n ** 18n; // 200 STRK
    const fundTx = await deployerAcct.execute({
      contractAddress: strk.address,
      entrypoint: "transfer",
      calldata: [wallet.address, num.toHex(funding & ((1n << 128n) - 1n)), num.toHex(funding >> 128n)],
    });
    await provider.waitForTransaction(fundTx.transaction_hash, { retryInterval: 3000 });
    console.log(`[live-acceptance] funded ${wallet.address} with 200 STRK (tx ${fundTx.transaction_hash})`);

    // 2. Deploy the fresh account (DEPLOY_ACCOUNT, Wallet Core local signer).
    const deploy = await runtime.deploy();
    console.log(`[live-acceptance] deployed account at block ${deploy.deployedAtBlock ?? "?"} (tx ${deploy.transactionHash})`);

    // 3. Wait for proving maturity (deploy block + 10).
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      await runtime.refreshPrivacyMaturity();
      ready = runtime.getState().privacy.maturity === "ready";
      if (!ready) {
        console.log(`[live-acceptance] waiting for proving maturity (${i + 1}/60)...`);
      }
    }
    if (!ready) throw new Error("Account did not reach STRK20 proving maturity in time.");

    // 4. STRK20 registration (real apply_actions, Wallet Core signer).
    const reg = await runtime.register();
    expect(reg.status).toBe("PENDING");
    console.log(`[live-acceptance] register tx ${reg.transactionHash}`);

    // 5. Shield a real deposit (0.5 STRK) — creates the private balance.
    const shieldAmount = 5n * 10n ** 17n; // 0.5 STRK
    const shield = await runtime.shield(strk.address, shieldAmount);
    expect(shield.status).toBe("PENDING");
    console.log(`[live-acceptance] shield tx ${shield.transactionHash}`);

    // 6. Private balance discovery (wallet-native viewing key + discovery service).
    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow).toBeDefined();
    expect(strkRow!.balance).toBeGreaterThanOrEqual(shieldAmount);
    console.log(`[live-acceptance] private STRK balance ${strkRow!.balance.toString()}`);

    // 7. Private identity (the shadow execution identity; probe used as the test identity namespace).
    const identity = await runtime.createPrivateIdentity("acceptance");
    console.log(`[live-acceptance] identity ${identity.id} commitment ${identity.commitmentNonce0}`);

    // 8. Real private application execution (0.2 STRK → probe.privacy_invoke).
    const execAmount = 2n * 10n ** 17n; // 0.2 STRK
    const receipt = await runtime.executePrivate({
      action: "application.invoke",
      token: strk.address,
      amount: execAmount,
      targetContract: probe,
      identity: identity.id,
    });
    expect(receipt.status).toBe("PENDING");
    console.log(`[live-acceptance] private execution tx ${receipt.transactionHash}`);
    expect(runtime.getState().executionOp.phase).toBe("success");

    // 9. Verify the application-side result ON-CHAIN.
    const countRes = await provider.callContract({
      contractAddress: probe,
      entrypoint: "get_execution_count",
      calldata: [identity.commitmentNonce0],
    });
    const count = BigInt(countRes[0] ?? "0x0");
    console.log(`[live-acceptance] probe execution count for identity: ${count.toString()}`);
    expect(count).toBe(1n);

    const last = await provider.callContract({
      contractAddress: probe,
      entrypoint: "get_last_execution",
      calldata: [identity.commitmentNonce0],
    });
    // last = [identity, amount_low, amount_high, caller, block, count_after]
    const lastAmount = BigInt(last[1] ?? "0x0");
    console.log(`[live-acceptance] probe last amount ${lastAmount.toString()} caller ${last[3] ?? ""}`);
    expect(lastAmount).toBe(execAmount);
    expect(num.toHex(BigInt(last[3] ?? "0x0"))).toBe(num.toHex(BigInt(strk.address)));

    // The probe must have received the STRK the private balance spent on it.
    const probeBalance = await provider.callContract({
      contractAddress: strk.address,
      entrypoint: "balanceOf",
      calldata: [probe],
    });
    const probeStrk = BigInt(probeBalance[0] ?? "0x0") + (BigInt(probeBalance[1] ?? "0x0") << 128n);
    console.log(`[live-acceptance] probe STRK balance ${probeStrk.toString()}`);
    expect(probeStrk).toBeGreaterThanOrEqual(execAmount);

    console.log(`[live-acceptance] ACCEPTANCE PASSED — execution tx ${receipt.transactionHash}`);
  }, 20 * 60_000);
});