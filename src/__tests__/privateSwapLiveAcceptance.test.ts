/**
 * @file privateSwapLiveAcceptance.test.ts
 * @description Stage 3C REAL Sepolia acceptance gate for the STRK20 SHADOW-ACCOUNT PRIVATE SWAP.
 *
 *   Full live path (no mocks):
 *     deployer (funded) → funds a FRESH Wallet Core Ready wallet → DEPLOY_ACCOUNT → 10-block
 *     proving maturity → STRK20 register → shield → private balance discovery → shadow identity
 *     (appName, nonce) → real on-chain quote (`quote_buy` on the STRKFTW BondingCurve V2) →
 *     WalletRuntime.executePrivateSwap (REAL shadowAccounts path) → private paymaster relay →
 *     real Sepolia tx → verify: the swap changed the curve's real reserves, the STRKFTW private
 *     balance grew, the curve's Buy event saw the SHADOW ACCOUNT (not the root wallet) as trader,
 *     the outer tx sender != root wallet, and the root wallet was never the application caller.
 *
 *   Requires: `RUN_LIVE_ACCEPTANCE=1`, deployments/deployer_account.json (funded), a reachable
 *   STRK20 prover + discovery (NEXT_PUBLIC_STRK20_*), the STRKFTW BondingCurve V2 + token
 *   (deployed in deployments/umbra-launch-v2.json), and the RC5 anonymizer
 *   (NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA). Skips honestly otherwise — never fakes success.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Account, RpcProvider, num } from "starknet";
import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";
import { STRKFTW_CURVE, STRKFTW_TOKEN, PRIVATE_SWAP_APPS } from "../features/private-swap";
import { getNetworkConfig } from "../config/networks";

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

const CURVE_ABI = [
  { type: "function", name: "quote_buy", inputs: [{ type: "felt", name: "base_amount" }], outputs: [{ type: "felt" }], state_mutability: "view" },
  { type: "function", name: "get_real_reserves", inputs: [], outputs: [{ type: "felt", name: "base" }, { type: "felt", name: "token" }], state_mutability: "view" },
  { type: "function", name: "is_graduated", inputs: [], outputs: [{ type: "felt" }], state_mutability: "view" },
];

describe("REAL SHADOW ACCOUNT — real Sepolia private swap acceptance", () => {
  it("runs the full live shadow-account private swap and verifies the shadow was the swap trader", async (ctx) => {
    if (process.env.RUN_LIVE_ACCEPTANCE !== "1") {
      console.log("[private-swap-live] SKIPPED: set RUN_LIVE_ACCEPTANCE=1 to run the funded live gate.");
      return ctx.skip();
    }
    const deployer = deployerWallet();
    if (!deployer) {
      console.log("[private-swap-live] SKIPPED: deployments/deployer_account.json (funded wallet) not present.");
      return ctx.skip();
    }
    const proverUrl = (process.env.NEXT_PUBLIC_STRK20_PROVER_URL ?? "").trim();
    const discoveryUrl = (process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? "").trim();
    const anonymizer = (process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA ?? "").trim();
    if (!proverUrl || !discoveryUrl || !anonymizer) {
      console.log("[private-swap-live] SKIPPED: operator prover/discovery or anonymizer not configured.");
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
      console.log("[private-swap-live] SKIPPED: discovery service unreachable from this environment.");
      return ctx.skip();
    }

    const rpc = (process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "").trim() || undefined;
    const provider = new RpcProvider({ nodeUrl: rpc ?? "https://starknet-sepolia-rpc.publicnode.com" });
    const deployerAcct = new Account({ provider, address: deployer.address, signer: deployer.privateKey });

    const runtime = new WalletRuntime({ storage: createMemoryStorage(), lazy: true });
    runtime.init();
    const wallet = await runtime.create(PASSWORD);
    console.log(`[private-swap-live] fresh wallet ${wallet.address}`);

    const strk = getNetworkConfig("sepolia").tokens[0];
    const app = PRIVATE_SWAP_APPS.find((a) => a.network === "sepolia");
    if (!app) throw new Error("No private-swap app configured for sepolia.");
    console.log(
      `[private-swap-live] swap app ${app.id} curve ${app.swapContract} sell ${app.sellToken.symbol} buy ${app.buyToken.symbol}`,
    );

    // Confirm the curve is live + not graduated (real liquidity), and quote a small swap.
    const curveReservesBefore = await provider.callContract({
      contractAddress: STRKFTW_CURVE,
      entrypoint: "get_real_reserves",
      calldata: [],
    });
    const beforeBase = BigInt(curveReservesBefore[0] ?? "0x0");
    const beforeToken = BigInt(curveReservesBefore[1] ?? "0x0");
    const graduated = await provider.callContract({ contractAddress: STRKFTW_CURVE, entrypoint: "is_graduated", calldata: [] });
    console.log(`[private-swap-live] curve base_reserve=${beforeBase.toString()} token_reserve=${beforeToken.toString()} graduated=${graduated[0]}`);
    expect(BigInt(graduated[0] ?? "0x0")).toBe(0n);

    const sellAmount = 500n * 10n ** 15n; // 0.5 STRK
    const quoted = await provider.callContract({ contractAddress: STRKFTW_CURVE, entrypoint: "quote_buy", calldata: ["0x" + sellAmount.toString(16)] });
    const quotedBuy = BigInt(quoted[0] ?? "0x0");
    console.log(`[private-swap-live] quote_buy(${sellAmount.toString()} base) = ${quotedBuy.toString()} STRKFTW base`);
    expect(quotedBuy).toBeGreaterThan(0n);

    // 1. Deployer funds the fresh wallet (public STRK transfer) — enough for deploy + pool fees +
    // shield + the private-paymaster relay fee (~16.5 STRK on Sepolia) + the node's resource-bounds
    // pre-check (gas-price × 2 headroom ≈ 72 STRK on the wallet at submission).
    const funding = 120n * 10n ** 18n;
    const fundTx = await deployerAcct.execute({
      contractAddress: strk.address,
      entrypoint: "transfer",
      calldata: [wallet.address, num.toHex(funding & ((1n << 128n) - 1n)), num.toHex(funding >> 128n)],
    });
    await provider.waitForTransaction(fundTx.transaction_hash, { retryInterval: 3000 });
    console.log(`[private-swap-live] funded ${wallet.address} (tx ${fundTx.transaction_hash})`);

    // 2. Deploy + wait for proving maturity.
    const deploy = await runtime.deploy();
    console.log(`[private-swap-live] deployed account at block ${deploy.deployedAtBlock ?? "?"} (tx ${deploy.transactionHash})`);
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      await runtime.refreshPrivacyMaturity();
      ready = runtime.getState().privacy.maturity === "ready";
    }
    if (!ready) throw new Error("Account did not reach STRK20 proving maturity in time.");

    // 3. Shield — the FIRST shield auto-registers the viewing key + opens channels in ONE proof.
    const shieldAmount = 30n * 10n ** 18n;
    const shield = await runtime.shield(strk.address, shieldAmount);
    console.log(`[private-swap-live] shield tx ${shield.transactionHash}`);

    // Wait generously for note maturity before the shadow spend.
    console.log("[private-swap-live] waiting ~75s for note maturity before the private swap...");
    await new Promise((r) => setTimeout(r, 75_000));

    // 4. Private balance discovery.
    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow).toBeDefined();
    expect(strkRow!.balance).toBeGreaterThanOrEqual(shieldAmount);
    console.log(`[private-swap-live] private STRK balance ${strkRow!.balance.toString()}`);

    // 5. Shadow identity (appName, nonce).
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    console.log(`[private-swap-live] identity commitment ${identity.commitment} shadow ${identity.shadowAddress}`);

    // 6. REAL private swap: private STRK → shadow account → BondingCurve.buy → private STRKFTW.
    const confirmedQuote = await runtime.quotePrivateSwap({
      action: "private.swap",
      sellToken: app.sellToken.address,
      buyToken: app.buyToken.address,
      sellAmount,
      slippageBps: 100,
      appName: "orrange",
      nonce: 0n,
    });
    console.log(
      `[private-swap-live] confirmed quote buyAmount=${confirmedQuote.buyAmount.toString()} minOutput=${confirmedQuote.minOutput.toString()} fee=${confirmedQuote.feeStrk?.toString() ?? "n/a"}`,
    );
    expect(confirmedQuote.buyAmount).toBe(quotedBuy);

    const receipt = await runtime.executePrivateSwap(
      {
        action: "private.swap",
        sellToken: app.sellToken.address,
        buyToken: app.buyToken.address,
        sellAmount,
        slippageBps: 100,
        appName: "orrange",
        nonce: 0n,
      },
      confirmedQuote,
    );
    console.log(`[private-swap-live] private swap tx ${receipt.transactionHash}`);
    expect(receipt.shadowAddress).toBe(identity.shadowAddress);
    expect(runtime.getState().swapOp.phase).toBe("success");

    // 7. Verify the swap actually changed the curve state (real application state transition).
    const curveReservesAfter = await provider.callContract({
      contractAddress: STRKFTW_CURVE,
      entrypoint: "get_real_reserves",
      calldata: [],
    });
    const afterBase = BigInt(curveReservesAfter[0] ?? "0x0");
    const afterToken = BigInt(curveReservesAfter[1] ?? "0x0");
    console.log(`[private-swap-live] curve base_reserve after=${afterBase.toString()} token_reserve after=${afterToken.toString()}`);
    expect(afterBase).toBeGreaterThan(beforeBase);
    expect(afterToken).toBeGreaterThan(beforeToken);

    // 8. Verify the curve's Buy event recorded the SHADOW ACCOUNT as trader (not the root wallet).
    const txReceipt = (await provider.getTransactionReceipt(receipt.transactionHash)) as unknown as {
      events?: { from_address?: string; keys?: string[]; data?: string[] }[];
      execution_status?: string;
    };
    console.log(`[private-swap-live] tx execution_status ${txReceipt?.execution_status ?? "?"}`);
    expect(txReceipt?.execution_status ?? "").toBe("SUCCEEDED");
    const events = txReceipt?.events ?? [];
    // The BondingCurve Buy event: keys[0] is the felt selector (not a readable string) and the
    // event carries `{ trader, recipient, base_amount, token_out, fee, base_after, token_after }`.
    // Detect it by from_address == curve + data shape (trader + recipient + base + token_out).
    const curveBuyEvents = events.filter(
      (e) =>
        e.from_address &&
        BigInt(e.from_address).toString(16) === BigInt(STRKFTW_CURVE).toString(16) &&
        Array.isArray(e.data) &&
        e.data.length >= 4,
    );
    console.log(`[private-swap-live] curve Buy events observed: ${curveBuyEvents.length}`);
    expect(curveBuyEvents.length).toBeGreaterThan(0);
    // Buy event data: [0]=trader (the shadow account), [1]=recipient, [2]=base_amount, [3]=token_out.
    const firstBuy = curveBuyEvents[0];
    const trader = "0x" + BigInt(firstBuy.data?.[0] ?? "0x0").toString(16);
    const recipient = "0x" + BigInt(firstBuy.data?.[1] ?? "0x0").toString(16);
    const baseAmount = BigInt(firstBuy.data?.[2] ?? "0x0");
    const tokenOut = BigInt(firstBuy.data?.[3] ?? "0x0");
    console.log(`[private-swap-live] Buy event trader ${trader} recipient ${recipient} base ${baseAmount.toString()} token_out ${tokenOut.toString()}`);
    expect(trader.toLowerCase()).toBe(identity.shadowAddress.toLowerCase());
    expect(recipient.toLowerCase()).toBe(identity.shadowAddress.toLowerCase());
    expect(baseAmount).toBe(sellAmount);
    expect(tokenOut).toBe(quotedBuy);
    // Slippage / min-output enforced: actual output >= confirmed min-output.
    expect(tokenOut).toBeGreaterThanOrEqual(confirmedQuote.minOutput);

    // 9. The ROOT wallet is NOT the application caller (curve saw the shadow account).
    expect(trader.toLowerCase()).not.toBe(wallet.address.toLowerCase());

    // 10. Outer tx sender must NOT be the root wallet (relayed by the private paymaster).
    const outer = await provider.getTransactionByHash(receipt.transactionHash);
    const outerSender = "sender_address" in outer ? ("0x" + BigInt(String(outer.sender_address)).toString(16)) : "";
    console.log(`[private-swap-live] outer tx sender ${outerSender}`);
    expect(outerSender.toLowerCase()).not.toBe(wallet.address.toLowerCase());
    expect(outerSender.toLowerCase()).not.toBe(identity.shadowAddress.toLowerCase());

    // 11. STRKFTW private balance grew (the buy output was collected back into a private note).
    //     The runtime's `refreshPrivateBalances` only lists the network's configured tokens, so
    //     read the STRKFTW note through the privacy session's discovery directly (viewing key
    //     stays inside the session; only the safe balance is returned).
    const privacy = (runtime as unknown as { privacySession?: unknown }).privacySession as
      | import("@/wallet/privacy").WalletPrivacySession
      | undefined;
    expect(privacy).toBeDefined();
    const strkftwPrivate = await privacy!.getPrivateBalance(STRKFTW_TOKEN.address);
    console.log(`[private-swap-live] private STRKFTW balance ${strkftwPrivate.toString()}`);
    expect(strkftwPrivate).toBeGreaterThan(0n);
    // The received private amount meets the confirmed min-output (slippage protection).
    expect(strkftwPrivate).toBeGreaterThanOrEqual(confirmedQuote.minOutput);

    console.log(
      `[private-swap-live] ACCEPTANCE PASSED — private swap tx ${receipt.transactionHash} · shadow ${identity.shadowAddress} · ` +
        `sold ${sellAmount.toString()} STRK base · curve base ${beforeBase.toString()} → ${afterBase.toString()}`,
    );
  }, 25 * 60_000);
});