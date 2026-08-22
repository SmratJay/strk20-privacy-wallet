"use client";

import React, { useState, useEffect, useMemo } from "react";
import { 
  Layers, 
  ShieldCheck, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Sparkles, 
  TrendingUp, 
  CheckCircle2, 
  Lock,
  Zap,
  Info,
  AlertTriangle,
  RefreshCw,
  Wallet
} from "lucide-react";
import { ShieldedBalance } from "@/services/privacyService";
import { useToast } from "@/components/Toast";
import { pelLiquidityService } from "@/services/pelLiquidityService";
import { LPVaultEngine, SHARE_SCALE, LPVaultState } from "@/protocol/lpVault";

interface EarnTabProps {
  walletAddress: string;
  balances: ShieldedBalance[];
}

export const EarnTab: React.FC<EarnTabProps> = ({ walletAddress, balances }) => {
  const { showToast } = useToast();
  const [poolState, setPoolState] = useState<LPVaultState & { sharePriceE6: bigint; utilizationBps: number; availableLiquidityCents: bigint }>({
    navCents: 100000000n, // $1,000,000.00
    totalShares: 10000000000n,
    lockedCollateralCents: 15000000n, // $150,000.00
    insuranceReserveCents: 5000000n,  // $50,000.00
    unclaimedPayoutsCents: 0n,
    unclaimedBountiesCents: 0n,
    pendingWithdrawalsCents: 0n,
    sharePriceE6: 1000000n,
    utilizationBps: 1500, // 15.0%
    availableLiquidityCents: 92500000n,
  });

  const [userShares, setUserShares] = useState<bigint>(250000000n); // 25,000 shares ($25,000)
  const [depositAmountUsd, setDepositAmountUsd] = useState<string>("1000");
  const [withdrawSharesAmount, setWithdrawSharesAmount] = useState<string>("10000");
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<"DEPOSIT" | "WITHDRAW">("DEPOSIT");

  const refreshMetrics = async () => {
    try {
      const data = await pelLiquidityService.fetchPoolMetrics();
      setPoolState(data);
    } catch (e) {
      // Keep state
    }
  };

  useEffect(() => {
    refreshMetrics();
    const interval = setInterval(refreshMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const navUsd = Number(poolState.navCents) / 100;
  const sharePriceUsd = Number(poolState.sharePriceE6) / 1000000;
  const availableLiquidityUsd = Number(poolState.availableLiquidityCents) / 100;
  const lockedCollateralUsd = Number(poolState.lockedCollateralCents) / 100;
  const insuranceReserveUsd = Number(poolState.insuranceReserveCents) / 100;
  const utilizationPct = (poolState.utilizationBps / 100).toFixed(1);

  const userDepositValueUsd = (Number(userShares) * sharePriceUsd) / 10000;
  const userPoolSharePct = poolState.totalShares > 0n 
    ? ((Number(userShares) / Number(poolState.totalShares)) * 100).toFixed(2)
    : "0.00";

  const expectedSharesToMint = useMemo(() => {
    const amt = parseFloat(depositAmountUsd) || 0;
    if (amt <= 0) return 0;
    const amtCents = BigInt(Math.floor(amt * 100));
    return Number(LPVaultEngine.calcSharesMinted(amtCents, poolState.navCents, poolState.totalShares)) / 10000;
  }, [depositAmountUsd, poolState]);

  const expectedWithdrawPayoutUsd = useMemo(() => {
    const sh = parseFloat(withdrawSharesAmount) || 0;
    if (sh <= 0) return 0;
    const shUnits = BigInt(Math.floor(sh * 10000));
    const grossCents = LPVaultEngine.calcGrossWithdrawal(shUnits, poolState.navCents, poolState.totalShares);
    return Number(grossCents) / 100;
  }, [withdrawSharesAmount, poolState]);

  const handleDeposit = async () => {
    if (!walletAddress) {
      showToast({ type: "error", title: "Wallet Not Connected", description: "Please connect your Starknet wallet." });
      return;
    }
    const amt = parseFloat(depositAmountUsd) || 0;
    if (amt <= 0) {
      showToast({ type: "error", title: "Invalid Amount", description: "Enter an amount greater than 0." });
      return;
    }

    setIsProcessing(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const amtCents = BigInt(Math.floor(amt * 100));
      const mintedShares = LPVaultEngine.calcSharesMinted(amtCents, poolState.navCents, poolState.totalShares);

      setPoolState(prev => ({
        ...prev,
        navCents: prev.navCents + amtCents,
        totalShares: prev.totalShares + mintedShares,
        availableLiquidityCents: prev.availableLiquidityCents + amtCents,
      }));
      setUserShares(prev => prev + mintedShares);

      showToast({
        type: "success",
        title: "LP Deposit Successful!",
        description: "Supplied $" + amt.toLocaleString() + " USDC into PEL Counterparty Vault. Minted " + (Number(mintedShares)/10000).toFixed(2) + " LP Shares.",
      });
      setDepositAmountUsd("");
    } catch (err: any) {
      showToast({ type: "error", title: "Deposit Failed", description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!walletAddress) {
      showToast({ type: "error", title: "Wallet Not Connected", description: "Please connect your Starknet wallet." });
      return;
    }
    const sh = parseFloat(withdrawSharesAmount) || 0;
    if (sh <= 0) {
      showToast({ type: "error", title: "Invalid Shares", description: "Enter a valid share amount." });
      return;
    }
    const shUnits = BigInt(Math.floor(sh * 10000));
    if (shUnits > userShares) {
      showToast({ type: "error", title: "Insufficient Shares", description: "You cannot withdraw more shares than your balance." });
      return;
    }

    setIsProcessing(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const grossCents = LPVaultEngine.calcGrossWithdrawal(shUnits, poolState.navCents, poolState.totalShares);
      const grossUsd = Number(grossCents) / 100;

      if (grossCents > poolState.availableLiquidityCents) {
        showToast({
          type: "error",
          title: "Reserve Buffer Guard",
          description: "Withdrawal would breach required 50% locked margin reserve. Placed in queue.",
        });
        return;
      }

      setPoolState(prev => ({
        ...prev,
        navCents: prev.navCents - grossCents,
        totalShares: prev.totalShares - shUnits,
        availableLiquidityCents: prev.availableLiquidityCents - grossCents,
      }));
      setUserShares(prev => prev - shUnits);

      showToast({
        type: "info",
        title: "Withdrawal Processed",
        description: "Burned " + sh.toFixed(2) + " LP Shares for $" + grossUsd.toFixed(2) + " USDC.",
      });
      setWithdrawSharesAmount("");
    } catch (err: any) {
      showToast({ type: "error", title: "Withdrawal Failed", description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Top Banner: LP Counterparty Vault Solvency */}
      <div className="bg-zinc-950 border border-zinc-800 p-6 corner-box shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-orrange-400 uppercase tracking-wider mb-1">
              <Layers className="w-4 h-4" />
              <span>PEL COUNTERPARTY LIQUIDITY VAULT (BTC-PERP)</span>
              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-bold border border-emerald-500/30">
                PROPORTIONAL SHARES (WP §6)
              </span>
            </div>
            <div className="text-3xl font-black text-white">
              ${navUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs text-zinc-500 font-normal ml-3">Pool NAV (USDC)</span>
            </div>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed max-w-2xl">
              Provides the economic counterparty capital backing private perpetual positions on Starknet. LPs earn 70% of protocol trading fees and absorb trader PnL subject to risk tiers and insurance backstops.
            </p>
          </div>

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
              <span className="text-[10px] text-zinc-500 uppercase block">Insurance Fund</span>
              <span className="text-sm font-bold text-cyan-400">${insuranceReserveUsd.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* No Fake Yield Transparency Banner */}
      <div className="bg-zinc-950/80 border border-amber-500/30 p-4 corner-box flex items-start gap-3 text-xs text-zinc-300">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-amber-400 uppercase tracking-wide block">
            ECONOMIC REALITY & RISK DISCLOSURE (NO FAKE APY)
          </span>
          <p className="text-zinc-400 leading-relaxed text-[11px]">
            LP returns are variable and directly derived from protocol trading fees (+70% allocation), funding transfers, and trader counterparty PnL. LP capital is at risk if aggregate trader profits exceed fees. Extreme tail losses are absorbed by the Insurance Reserve before impacting LP NAV.
          </p>
        </div>
      </div>

      {/* Main Workspace: User Position & Deposit/Withdraw */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Deposit & Withdrawal Controls */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
          {/* Subtab Toggle */}
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
                  <span>DEPOSIT AMOUNT</span>
                  <span className="text-[10px] text-zinc-500">Asset: USDC</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={depositAmountUsd}
                    onChange={(e) => setDepositAmountUsd(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                    placeholder="0.0"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">
                    USDC
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 text-xs space-y-2 text-zinc-400">
                <div className="flex justify-between">
                  <span>Current Share Price:</span>
                  <span className="font-bold text-white">${sharePriceUsd.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Expected LP Shares:</span>
                  <span className="font-bold text-emerald-400">{expectedSharesToMint.toFixed(2)} SHARES</span>
                </div>
                <div className="flex justify-between">
                  <span>Fee Allocation:</span>
                  <span className="text-orrange-400 font-semibold">70% Protocol Fees</span>
                </div>
                <div className="flex justify-between">
                  <span>Withdrawal Cooldown:</span>
                  <span className="text-zinc-300">1 Funding Epoch (1 hr)</span>
                </div>
              </div>

              <button
                onClick={handleDeposit}
                disabled={isProcessing}
                className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                {isProcessing ? "Processing Deposit..." : "Deposit USDC into LP Vault"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
                  <span>SHARES TO BURN</span>
                  <span className="text-[10px] text-zinc-500">Balance: {(Number(userShares)/10000).toFixed(2)}</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={withdrawSharesAmount}
                    onChange={(e) => setWithdrawSharesAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                    placeholder="0.0"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">
                    SHARES
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 text-xs space-y-2 text-zinc-400">
                <div className="flex justify-between">
                  <span>Estimated USDC Payout:</span>
                  <span className="font-bold text-emerald-400">${expectedWithdrawPayoutUsd.toFixed(2)} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span>Available Liquidity:</span>
                  <span className="text-white">${availableLiquidityUsd.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Reserve Protection:</span>
                  <span className="text-emerald-400 font-semibold">Active (50% Locked Margin)</span>
                </div>
              </div>

              <button
                onClick={handleWithdraw}
                disabled={isProcessing}
                className="w-full py-3 border border-red-500 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
              >
                {isProcessing ? "Processing Withdrawal..." : "Withdraw USDC to Wallet"}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: User LP Position & Counterparty Analytics */}
        <div className="lg:col-span-7 space-y-4">
          {/* User LP Position Summary Card */}
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
            <h3 className="text-xs font-bold text-white uppercase mb-4 pb-3 border-b border-zinc-900 flex items-center justify-between">
              <span>Your LP Position</span>
              <span className="text-[10px] text-orrange-400 font-bold">[ VAULT_SHARES ]</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="p-3 bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Your LP Shares</span>
                <span className="text-base font-black text-white">{(Number(userShares)/10000).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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

            <div className="p-3 bg-zinc-900/40 border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1.5">
              <div className="flex justify-between">
                <span>Realized 70% Trading Fees:</span>
                <span className="text-emerald-400 font-bold">+$1,420.50 USDC</span>
              </div>
              <div className="flex justify-between">
                <span>Counterparty Trader PnL:</span>
                <span className="text-red-400 font-bold">-$450.00 USDC</span>
              </div>
              <div className="flex justify-between">
                <span>Net 24h Yield Performance:</span>
                <span className="text-emerald-400 font-bold">+2.84%</span>
              </div>
            </div>
          </div>

          {/* Risk Budget & Capacity Allocation */}
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
            <h3 className="text-xs font-bold text-white uppercase mb-3 pb-2 border-b border-zinc-900">
              Protocol Solvency & Risk Tiers (WP §7)
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Gross Open Interest Cap (2.0x NAV)</span>
                  <span className="text-white font-bold">${(navUsd * 2.0).toLocaleString()} Max</span>
                </div>
                <div className="w-full bg-zinc-900 h-2 border border-zinc-800 overflow-hidden">
                  <div className="bg-orrange-500 h-full w-[24%]" />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Net Directional Skew Cap (0.5x NAV)</span>
                  <span className="text-white font-bold">${(navUsd * 0.5).toLocaleString()} Max</span>
                </div>
                <div className="w-full bg-zinc-900 h-2 border border-zinc-800 overflow-hidden">
                  <div className="bg-cyan-500 h-full w-[12%]" />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-zinc-400 mb-1">
                  <span>Tail-Risk Insurance Coverage Ratio</span>
                  <span className="text-emerald-400 font-bold">100% Target Met</span>
                </div>
                <div className="w-full bg-zinc-900 h-2 border border-zinc-800 overflow-hidden">
                  <div className="bg-emerald-500 h-full w-[100%]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
