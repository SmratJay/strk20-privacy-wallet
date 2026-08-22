"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Layers,
  AlertTriangle,
  RefreshCw,
  Info,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { pelLiquidityService, PoolMetrics } from "@/services/pelLiquidityService";
import { LPVaultEngine, TOKEN_DECIMAL_MULTIPLIER } from "@/protocol/lpVault";
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from "@/services/starknetPerpsDispatcher";

interface EarnTabProps {
  walletAddress: string;
}

type VaultStatus = "LOADING" | "UNAVAILABLE" | "READY";

interface TxState {
  status: "IDLE" | "PENDING" | "CONFIRMED" | "FAILED";
  message?: string;
  txHash?: string;
}

export const EarnTab: React.FC<EarnTabProps> = ({ walletAddress }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<VaultStatus>("LOADING");
  const [metrics, setMetrics] = useState<PoolMetrics | null>(null);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [lastReconciledAt, setLastReconciledAt] = useState<number>(0);

  const [depositAmountUsd, setDepositAmountUsd] = useState<string>("1000");
  const [withdrawSharesAmount, setWithdrawSharesAmount] = useState<string>("");
  const [activeSubTab, setActiveSubTab] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");
  const [depositTx, setDepositTx] = useState<TxState>({ status: "IDLE" });
  const [withdrawTx, setWithdrawTx] = useState<TxState>({ status: "IDLE" });
  const [pendingWithdrawalId, setPendingWithdrawalId] = useState<bigint | null>(null);

  const vaultAddress = PERPS_DEPLOYMENTS.sepolia.lpVaultAddress;
  const collateralTokenAddress = PERPS_DEPLOYMENTS.sepolia.collateralTokenAddress;

  const reconcile = async () => {
    try {
      const data = await pelLiquidityService.fetchPoolMetrics();
      setMetrics(data);
      if (walletAddress) {
        const shares = await pelLiquidityService.fetchLpShares(walletAddress);
        setUserShares(shares);
      }
      setStatus("READY");
      setLastReconciledAt(Date.now());
    } catch (err: any) {
      const cfgProblems = (err?.message || "").includes("LP_DEPLOYMENT_CONFIG_ERROR");
      setStatus("UNAVAILABLE");
      if (!cfgProblems) {
        // Keep showing the unavailable banner; no fabricated values ever shown.
        console.warn('[EarnTab] reconcile failed', err?.message);
      }
    }
  };

  useEffect(() => {
    reconcile();
    const interval = setInterval(reconcile, 10_000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  const navUsd = metrics ? Number(metrics.navCents) / 100 : 0;
  const sharePriceUsd = metrics ? Number(metrics.sharePriceE6) / 1_000_000 : 0;
  const availableLiquidityUsd = metrics ? Number(metrics.availableLiquidityCents) / 100 : 0;
  const lockedCollateralUsd = metrics ? Number(metrics.lockedCollateralCents + metrics.poolMarginCents) / 100 : 0;
  const treasuryUsd = metrics ? Number(metrics.treasuryCents) / 100 : 0;
  const utilizationPct = metrics ? (metrics.utilizationBps / 100).toFixed(1) : "0.0";

  const userDepositValueUsd = metrics
    ? (Number(userShares) * sharePriceUsd) / 10_000
    : 0;
  const userPoolSharePct = metrics && metrics.totalShares > 0n
    ? ((Number(userShares) / Number(metrics.totalShares)) * 100).toFixed(2)
    : "0.00";

  const expectedSharesToMint = useMemo(() => {
    if (!metrics) return 0;
    const amt = parseFloat(depositAmountUsd) || 0;
    if (amt <= 0) return 0;
    const amtCents = BigInt(Math.floor(amt * 100));
    return Number(LPVaultEngine.calcSharesMinted(amtCents, metrics.navCents, metrics.totalShares)) / 10_000;
  }, [depositAmountUsd, metrics]);

  const expectedWithdrawPayoutUsd = useMemo(() => {
    if (!metrics) return 0;
    const sh = parseFloat(withdrawSharesAmount) || 0;
    if (sh <= 0) return 0;
    const shUnits = BigInt(Math.floor(sh * 10_000));
    const grossCents = LPVaultEngine.calcGrossWithdrawal(shUnits, metrics.navCents, metrics.totalShares);
    return Number(grossCents) / 100;
  }, [withdrawSharesAmount, metrics]);

  const getBrowserAccount = () => {
    const account = (window as any).starknet?.account;
    if (!account) {
      showToast({ type: "error", title: "Wallet Not Connected", description: "Connect your Starknet wallet to deposit or withdraw." });
      return null;
    }
    return account;
  };

  // Real deposit: approve -> deposit_liquidity -> wait for finality -> reconcile.
  const handleDeposit = async () => {
    if (status !== "READY") {
      showToast({ type: "error", title: "LP Vault Unavailable", description: "The LP vault is not deployed/configured. Cannot deposit." });
      return;
    }
    const account = getBrowserAccount();
    if (!account) return;

    const amt = parseFloat(depositAmountUsd) || 0;
    if (amt <= 0) {
      showToast({ type: "error", title: "Invalid Amount", description: "Enter an amount greater than 0." });
      return;
    }
    const amtCents = BigInt(Math.floor(amt * 100));

    setDepositTx({ status: "PENDING", message: "Approving USDC and depositing into the PEL Counterparty Vault..." });
    try {
      const calls = pelLiquidityService.buildDepositLiquidityCalls(amtCents, collateralTokenAddress);
      const result = await starknetPerpsDispatcher.executeOnChain(account, calls as any);
      if (result.status !== "SUCCESS") {
        setDepositTx({ status: "FAILED", message: `Transaction ${result.status}: ${result.transactionHash || "no tx"}` });
        showToast({ type: "error", title: "Deposit Not Confirmed", description: `On-chain status: ${result.status}. No shares were credited.` });
        return;
      }
      setDepositTx({ status: "CONFIRMED", message: "Deposit accepted on-chain.", txHash: result.transactionHash });
      await reconcile();
      showToast({ type: "success", title: "LP Deposit Confirmed", description: `$${amt.toLocaleString()} deposited on-chain. Shares credited from real state.` });
      setDepositAmountUsd("");
    } catch (err: any) {
      setDepositTx({ status: "FAILED", message: err.message });
      showToast({ type: "error", title: "Deposit Failed", description: err.message });
    }
  };

  // Real withdraw: request_withdrawal -> wait cooldown -> claim_withdrawal.
  const handleRequestWithdrawal = async () => {
    if (status !== "READY") {
      showToast({ type: "error", title: "LP Vault Unavailable", description: "The LP vault is not deployed/configured." });
      return;
    }
    const account = getBrowserAccount();
    if (!account) return;

    const sh = parseFloat(withdrawSharesAmount) || 0;
    if (sh <= 0) {
      showToast({ type: "error", title: "Invalid Shares", description: "Enter a valid share amount." });
      return;
    }
    const shUnits = BigInt(Math.floor(sh * 10_000));
    if (shUnits > userShares) {
      showToast({ type: "error", title: "Insufficient Shares", description: `You hold ${(Number(userShares) / 10_000).toFixed(2)} shares.` });
      return;
    }

    setWithdrawTx({ status: "PENDING", message: "Requesting withdrawal on-chain..." });
    try {
      const call = pelLiquidityService.buildRequestWithdrawalCall(shUnits);
      const result = await starknetPerpsDispatcher.executeOnChain(account, call);
      if (result.status !== "SUCCESS") {
        setWithdrawTx({ status: "FAILED", message: `Transaction ${result.status}` });
        return;
      }
      setWithdrawTx({ status: "CONFIRMED", message: "Withdrawal queued. Cooldown: 1 funding epoch (1 hr)." });
      await reconcile();
      showToast({ type: "info", title: "Withdrawal Queued", description: "Request accepted. Claim after the 1-hour cooldown." });
    } catch (err: any) {
      setWithdrawTx({ status: "FAILED", message: err.message });
      showToast({ type: "error", title: "Withdrawal Request Failed", description: err.message });
    }
  };

  const handleClaimWithdrawal = async (requestId: bigint) => {
    if (status !== "READY") return;
    const account = getBrowserAccount();
    if (!account) return;

    setWithdrawTx({ status: "PENDING", message: "Claiming withdrawal on-chain..." });
    try {
      const call = pelLiquidityService.buildClaimWithdrawalCall(requestId);
      const result = await starknetPerpsDispatcher.executeOnChain(account, call);
      if (result.status !== "SUCCESS") {
        setWithdrawTx({ status: "FAILED", message: `Transaction ${result.status}` });
        return;
      }
      setWithdrawTx({ status: "CONFIRMED", message: "Withdrawal claimed.", txHash: result.transactionHash });
      setPendingWithdrawalId(null);
      await reconcile();
      showToast({ type: "success", title: "Withdrawal Claimed", description: "USDC transferred to your wallet on-chain." });
    } catch (err: any) {
      setWithdrawTx({ status: "FAILED", message: err.message });
    }
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Header */}
      <div className="bg-zinc-950 border border-zinc-800 p-6 corner-box shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-orrange-400 uppercase tracking-wider mb-1">
              <Layers className="w-4 h-4" />
              <span>PEL COUNTERPARTY LIQUIDITY VAULT</span>
              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-bold border border-emerald-500/30">
                REAL ON-CHAIN
              </span>
            </div>

            {status === "LOADING" && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading on-chain vault state...
              </div>
            )}

            {status === "UNAVAILABLE" && (
              <div className="flex items-start gap-2 text-sm text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">LP Vault Unavailable / Not Deployed.</span>
                  <p className="text-zinc-400 text-xs mt-1">
                    No fabricated metrics are shown. Deploy and configure
                    NEXT_PUBLIC_LP_VAULT_SEPOLIA, NEXT_PUBLIC_LP_INSURANCE_SEPOLIA,
                    NEXT_PUBLIC_LP_TREASURY_SEPOLIA to activate the LP counterparty.
                  </p>
                </div>
              </div>
            )}

            {status === "READY" && metrics && (
              <>
                <div className="text-3xl font-black text-white">
                  ${navUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-xs text-zinc-500 font-normal ml-3">Pool NAV (USDC)</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed max-w-2xl">
                  Real on-chain LP counterparty capital backing private perpetual positions.
                  Reconciles live with PELLiquidityVault every 10s. Trader PnL is 100%
                  counterparty PnL (LP gains full losses / pays full profits); protocol
                  revenue splits 70% LP / 20% insurance / 10% treasury.
                </p>
                {lastReconciledAt > 0 && (
                  <span className="text-[10px] text-zinc-600">
                    reconciled {new Date(lastReconciledAt).toLocaleTimeString()}
                  </span>
                )}
              </>
            )}
          </div>

          {status === "READY" && metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Share Price</span>
                <span className="text-sm font-bold text-white">${sharePriceUsd.toFixed(4)}</span>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Utilization</span>
                <span className="text-sm font-bold text-orrange-400">{utilizationPct}%</span>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Available Liq</span>
                <span className="text-sm font-bold text-emerald-400">${availableLiquidityUsd.toLocaleString()}</span>
              </div>
              <div className="p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Treasury</span>
                <span className="text-sm font-bold text-cyan-400">${treasuryUsd.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transparency banner */}
      <div className="bg-zinc-950/80 border border-amber-500/30 p-4 corner-box flex items-start gap-3 text-xs text-zinc-300">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-amber-400 uppercase tracking-wide block">
            ECONOMIC REALITY & RISK DISCLOSURE (NO FAKE APY)
          </span>
          <p className="text-zinc-400 leading-relaxed text-[11px]">
            LP returns are derived from real protocol revenue (fee/liquidation splits),
            funding, and trader counterparty PnL. LP capital is at risk if aggregate
            trader profits exceed LP NAV; tail losses are absorbed by the real USDC
            insurance reserve before hitting LP NAV. Bad debt beyond insurance is
            recorded explicitly — never fabricated away.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
          <div className="flex border-b border-zinc-800 pb-3 gap-2">
            <button
              onClick={() => setActiveSubTab("DEPOSIT")}
              className={"flex-1 py-2 text-xs font-bold uppercase transition-all cursor-pointer border " + (
                activeSubTab === "DEPOSIT"
                  ? "bg-orrange-500/10 text-orrange-400 border-orrange-500/40"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
              )}
            >
              Deposit Liquidity
            </button>
            <button
              onClick={() => setActiveSubTab("WITHDRAW")}
              className={"flex-1 py-2 text-xs font-bold uppercase transition-all cursor-pointer border " + (
                activeSubTab === "WITHDRAW"
                  ? "bg-orrange-500/10 text-orrange-400 border-orrange-500/40"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
              )}
            >
              Withdraw Shares
            </button>
          </div>

          {activeSubTab === "DEPOSIT" ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                  <span>DEPOSIT AMOUNT (USDC)</span>
                  <span className="text-[10px] text-zinc-500">Asset: {collateralTokenAddress.slice(0, 8)}...</span>
                </div>
                <input
                  type="number"
                  value={depositAmountUsd}
                  onChange={(e) => setDepositAmountUsd(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                  placeholder="0.0"
                />
              </div>

              {status === "READY" && metrics && (
                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 text-xs space-y-2 text-zinc-400">
                  <div className="flex justify-between">
                    <span>Current Share Price</span>
                    <span className="font-bold text-white">${sharePriceUsd.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expected LP Shares</span>
                    <span className="font-bold text-emerald-400">{expectedSharesToMint.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Withdrawal Cooldown</span>
                    <span className="text-zinc-300">1 Funding Epoch (1 hr)</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleDeposit}
                disabled={depositTx.status === "PENDING" || status !== "READY"}
                className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                {depositTx.status === "PENDING" ? "Broadcasting & Waiting Finality..." : "Deposit USDC (On-Chain)"}
              </button>

              {depositTx.status === "CONFIRMED" && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-xs">
                  <span className="font-bold">Deposit confirmed on-chain.</span>
                  <span className="block mt-1 break-all">tx: {depositTx.txHash}</span>
                </div>
              )}
              {depositTx.status === "FAILED" && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-400 text-xs">
                  <span className="font-bold">Deposit failed.</span>
                  <span className="block mt-1">{depositTx.message}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                  <span>SHARES TO WITHDRAW</span>
                  <span className="text-[10px] text-zinc-500">Balance: {(Number(userShares) / 10_000).toFixed(2)}</span>
                </div>
                <input
                  type="number"
                  value={withdrawSharesAmount}
                  onChange={(e) => setWithdrawSharesAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                  placeholder="0.0"
                />
              </div>

              {status === "READY" && metrics && (
                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 text-xs space-y-2 text-zinc-400">
                  <div className="flex justify-between">
                    <span>Estimated USDC Payout</span>
                    <span className="font-bold text-emerald-400">${expectedWithdrawPayoutUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Available Liquidity</span>
                    <span className="text-white">${availableLiquidityUsd.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleRequestWithdrawal}
                disabled={withdrawTx.status === "PENDING" || status !== "READY"}
                className="w-full py-3 border border-red-500 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                {withdrawTx.status === "PENDING" ? "Broadcasting Request..." : "Request Withdrawal (On-Chain)"}
              </button>

              {pendingWithdrawalId !== null && (
                <button
                  onClick={() => handleClaimWithdrawal(pendingWithdrawalId)}
                  disabled={withdrawTx.status === "PENDING"}
                  className="w-full py-3 border border-emerald-500 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  Claim Withdrawal #{pendingWithdrawalId.toString()}
                </button>
              )}

              {withdrawTx.status === "CONFIRMED" && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-xs">
                  <span className="font-bold">Withdrawal on-chain.</span>
                  <span className="block mt-1">{withdrawTx.message}</span>
                </div>
              )}
              {withdrawTx.status === "FAILED" && (
                <div className="p-3 bg-red-500/10 border border-red-500/40 text-red-400 text-xs">
                  <span className="font-bold">Withdrawal failed.</span>
                  <span className="block mt-1">{withdrawTx.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
            <h3 className="text-xs font-bold text-white uppercase mb-4 pb-3 border-b border-zinc-900 flex items-center justify-between">
              <span>Your LP Position</span>
              <span className="text-[10px] text-orrange-400 font-bold">[ VAULT_SHARES ]</span>
            </h3>

            {status === "READY" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="p-3 bg-zinc-900 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase block">Your LP Shares</span>
                  <span className="text-base font-black text-white">{(Number(userShares) / 10_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase block">Current Value</span>
                  <span className="text-base font-black text-emerald-400">${userDepositValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase block">Pool Ownership</span>
                  <span className="text-base font-black text-cyan-400">{userPoolSharePct}%</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Connect a wallet and wait for on-chain vault state to load.
              </p>
            )}
          </div>

          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
            <h3 className="text-xs font-bold text-white uppercase mb-3 pb-2 border-b border-zinc-900">
              Protocol Solvency & Risk Controls (On-Chain)
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Max Utilization (85% locked/NAV)</span>
                  <span className="text-white font-bold">{status === "READY" ? `${utilizationPct}%` : "--"}</span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Single Position Cap (5% NAV notional)</span>
                  <span className="text-white font-bold">
                    {status === "READY" ? `$${(Number(LPVaultEngine.maxSinglePositionMargin(metrics!.navCents)) / 100).toLocaleString()} margin max` : "--"}
                  </span>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Locked Counterparty Margin</span>
                  <span className="text-emerald-400 font-bold">${lockedCollateralUsd.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};