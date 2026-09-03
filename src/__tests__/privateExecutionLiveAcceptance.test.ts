/**
 * @file privateExecutionLiveAcceptance.test.ts
 * @description Stage 3B REAL Sepolia acceptance gate for STRK20 SHADOW-ACCOUNT execution.
 *
 *   Full live path (no mocks):
 *     deployer (funded) → funds a FRESH Wallet Core Ready wallet → DEPLOY_ACCOUNT → 10-block
 *     proving maturity → STRK20 register → shield → private balance discovery → shadow identity
 *     (appName, nonce) → WalletRuntime.executePrivate (REAL shadowAccounts) → private paymaster
 *     relay → real Sepolia tx → verify: the shadow account (not the root) called the probe,
 *     the probe recorded the shadow address, the outer tx sender != root wallet.
 *
 *   The funded deployer wallet itself was registered under a legacy viewing-key derivation in an
 *   earlier phase, so a FRESH wallet is used for the wallet-native STRK20 path.
 *
 *   Requires: `RUN_LIVE_ACCEPTANCE=1`, deployments/deployer_account.json (funded), a reachable
 *   STRK20 prover + discovery (NEXT_PUBLIC_STRK20_*), the deployed ShadowExecutionProbe address
 *   (NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA), and the RC5 anonymizer
 *   (NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA). Skips honestly otherwise — never fakes success.
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

describe("REAL SHADOW ACCOUNT — real Sepolia acceptance", () => {
  it("runs the full live shadow-account path and verifies the shadow was the application caller", async (ctx) => {
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
    const anonymizer = (process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA ?? "").trim();
    if (!proverUrl || !discoveryUrl || !probe || !anonymizer) {
      console.log("[live-acceptance] SKIPPED: operator prover/discovery, probe, or anonymizer not configured.");
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

    const runtime = new WalletRuntime({ storage: createMemoryStorage(), lazy: true });
    runtime.init();
    const wallet = await runtime.create(PASSWORD);
    console.log(`[live-acceptance] fresh wallet ${wallet.address}`);

    const strk = (await import("../config/networks")).getNetworkConfig("sepolia").tokens[0];

    // 1. Deployer funds the fresh wallet (public STRK transfer) — enough for deploy + pool fees.
    const funding = 200n * 10n ** 18n;
    const fundTx = await deployerAcct.execute({
      contractAddress: strk.address,
      entrypoint: "transfer",
      calldata: [wallet.address, num.toHex(funding & ((1n << 128n) - 1n)), num.toHex(funding >> 128n)],
    });
    await provider.waitForTransaction(fundTx.transaction_hash, { retryInterval: 3000 });
    console.log(`[live-acceptance] funded ${wallet.address} (tx ${fundTx.transaction_hash})`);

    // 2. Deploy + wait for proving maturity.
    const deploy = await runtime.deploy();
    console.log(`[live-acceptance] deployed account at block ${deploy.deployedAtBlock ?? "?"} (tx ${deploy.transactionHash})`);
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      await runtime.refreshPrivacyMaturity();
      ready = runtime.getState().privacy.maturity === "ready";
    }
    if (!ready) throw new Error("Account did not reach STRK20 proving maturity in time.");

    // 3. Shield — the FIRST shield auto-registers the viewing key + opens the self-channel +
//    subchannel in ONE proof (autoRegister + autoSetup). A separate register() before it is
//    deliberately avoided: the discovery indexer returns a freshly-opened channel as
//    "precomputed", so a subsequent shield's autoSetup would re-open it and the pool's WriteOnce
//    storage reverts with NON_ZERO_VALUE. One combined proof avoids the collision entirely.
    // Shield ~30 STRK so the mature note covers the shadow funding + the private-paymaster relay
    // fee (~17 STRK on Sepolia) with room for the note-maturity window.
    const shieldAmount = 30n * 10n ** 18n; // 30 STRK
    const shield = await runtime.shield(strk.address, shieldAmount);
    console.log(`[live-acceptance] shield tx ${shield.transactionHash}`);

    // The fresh shielded note must predate the proving block by the note-maturity window
    // (note created + 10 maturity + 10 proving margin). Wait generously before spending it.
    console.log("[live-acceptance] waiting ~75s for note maturity before the shadow spend...");
    await new Promise((r) => setTimeout(r, 75_000));

    // 4. Private balance discovery.
    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow).toBeDefined();
    expect(strkRow!.balance).toBeGreaterThanOrEqual(shieldAmount);
    console.log(`[live-acceptance] private STRK balance ${strkRow!.balance.toString()}`);

    // 5. Shadow identity (appName, nonce) — deterministic commitment + shadow address.
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    console.log(`[live-acceptance] identity commitment ${identity.commitment} shadow ${identity.shadowAddress}`);

    // 6. REAL shadow-account execution: private STRK → shadow account → probe.record.
    const execAmount = 2n * 10n ** 17n; // 0.2 STRK routed into the shadow
    const receipt = await runtime.executePrivate({
      action: "shadow.invoke",
      appName: "orrange",
      nonce: 0n,
      token: strk.address,
      amount: execAmount,
      calls: [{ contractAddress: probe, entrypoint: "record", calldata: [num.toHex(execAmount)] }],
    });
    console.log(`[live-acceptance] shadow execution tx ${receipt.transactionHash}`);
    expect(receipt.shadowAddress).toBe(identity.shadowAddress);
    expect(runtime.getState().executionOp.phase).toBe("success");

    // 7. Verify on-chain: the probe saw the SHADOW ACCOUNT (not the root) as caller.
    const countRes = await provider.callContract({
      contractAddress: probe,
      entrypoint: "get_execution_count",
      calldata: [identity.shadowAddress],
    });
    const count = BigInt(countRes[0] ?? "0x0");
    console.log(`[live-acceptance] probe execution count for shadow ${identity.shadowAddress}: ${count.toString()}`);
    expect(count).toBe(1n);

    const last = await provider.callContract({
      contractAddress: probe,
      entrypoint: "get_last_record",
      calldata: [identity.shadowAddress],
    });
    const caller = "0x" + BigInt(last[0] ?? "0x0").toString(16);
    const amount = BigInt(last[1] ?? "0x0");
    console.log(`[live-acceptance] probe last record caller ${caller} amount ${amount.toString()}`);
    expect(caller.toLowerCase()).toBe(identity.shadowAddress.toLowerCase());
    expect(amount).toBe(execAmount);

    // The ROOT wallet is NOT the application caller.
    expect(caller.toLowerCase()).not.toBe(wallet.address.toLowerCase());

    // 8. Outer tx sender must NOT be the root wallet (relayed by the private paymaster).
    const tx = await provider.getTransactionByHash(receipt.transactionHash);
    const outerSender =
      "sender_address" in tx ? ("0x" + BigInt(String(tx.sender_address)).toString(16)) : "";
    console.log(`[live-acceptance] outer tx sender ${outerSender}`);
    expect(outerSender.toLowerCase()).not.toBe(wallet.address.toLowerCase());

    // 9. The derived shadow address runs the anonymizer's shadow-account class (if deployed).
    const shadowClass = await provider.getClassHashAt(identity.shadowAddress);
    console.log(`[live-acceptance] shadow account class ${shadowClass}`);

    console.log(`[live-acceptance] ACCEPTANCE PASSED — shadow execution tx ${receipt.transactionHash}`);
  }, 25 * 60_000);
});