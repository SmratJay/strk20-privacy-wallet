'use client';

import React, { useMemo } from 'react';
import { 
  PieChart, 
  ShieldCheck, 
  TrendingUp, 
  Layers, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Zap, 
  Activity,
  Lock,
  Eye,
  ExternalLink
} from 'lucide-react';
import { ShieldedBalance } from '@/services/privacyService';
import { TokenInfo } from '@/config/tokens';
import { perpsService } from '@/services/perpsService';
import { earnService } from '@/services/earnService';

interface PortfolioTabProps {
  balances: ShieldedBalance[];
  walletAddress: string;
  onNavigateTab: (tab: any) => void;
}

export const PortfolioTab: React.FC<PortfolioTabProps> = ({
  balances,
  walletAddress,
  onNavigateTab,
}) => {
  // Current mock asset price mapping (USD)
  const tokenPrices: Record<string, number> = {
    STRK: 0.584,
    ETH: 3418.75,
    USDC: 1.00,
    USDT: 1.00,
    BTC: 96420.50,
  };

  // 1. Calculate Shielded Cash Value
  const shieldedCashUsd = useMemo(() => {
    return balances.reduce((acc, b) => {
      const price = tokenPrices[b.token.symbol] || 0;
      const amount = Number(b.shieldedBalance) / 10 ** b.token.decimals;
      return acc + amount * price;
    }, 0);
  }, [balances]);

  // 2. Calculate Public Balance Value
  const publicCashUsd = useMemo(() => {
    return balances.reduce((acc, b) => {
      const price = tokenPrices[b.token.symbol] || 0;
      const amount = Number(b.publicBalance) / 10 ** b.token.decimals;
      return acc + amount * price;
    }, 0);
  }, [balances]);

  // 3. Calculate Perp Position Margin & Equity (Section 13.1)
  const perpPositions = useMemo(() => {
    return walletAddress ? perpsService.getPositions(walletAddress).filter(p => p.status === 'OPEN') : [];
  }, [walletAddress]);

  const perpEquityUsd = useMemo(() => {
    return perpPositions.reduce((acc, p) => acc + p.marginUsd + p.unrealizedPnlUsd, 0);
  }, [perpPositions]);

  // 4. Calculate Earn / Lending Vault Value
  const userDeposits = useMemo(() => {
    return walletAddress ? earnService.getUserDeposits(walletAddress, tokenPrices) : [];
  }, [walletAddress]);

  const earnDepositsUsd = useMemo(() => {
    return userDeposits.reduce((acc, d) => acc + d.depositedAmountUsd + d.accruedYieldUsd, 0);
  }, [userDeposits]);

  // Total Private Net Worth: NetWorth = sum(Value(Ni)) + sum(Equity(Posj)) + sum(Value(Vaultk))
  const privateNetWorthUsd = shieldedCashUsd + perpEquityUsd + earnDepositsUsd;
  const totalCombinedNetWorth = privateNetWorthUsd + publicCashUsd;
  const privacyRatio = totalCombinedNetWorth > 0 ? (privateNetWorthUsd / totalCombinedNetWorth) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Top Banner: Total Net Worth Breakdown */}
      <div className="bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Total Private Net Worth (PEL Core)</span>
            </div>
            <div className="text-4xl font-extrabold text-white tracking-tight flex items-baseline gap-3">
              ${privateNetWorthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                {privacyRatio.toFixed(0)}% Shielded
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Confidential assets across STRK20 notes, perpetual positions, and yield vaults.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateTab('SHIELD')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-900/30 transition-all hover:scale-105"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              Shield Funds
            </button>
            <button
              onClick={() => onNavigateTab('SWAP')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              Trade
            </button>
            <button
              onClick={() => onNavigateTab('PERPS')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-all"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Open Perp
            </button>
          </div>
        </div>

        {/* 3 Pillar Allocations */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-zinc-800/80">
          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
            <div className="text-xs text-zinc-400 flex items-center justify-between mb-1">
              <span>1. Shielded Cash Notes</span>
              <Lock className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-lg font-bold text-white">
              ${shieldedCashUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">STRK, ETH, USDC Notes</div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
            <div className="text-xs text-zinc-400 flex items-center justify-between mb-1">
              <span>2. Perp Position Equity</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-lg font-bold text-white">
              ${perpEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{perpPositions.length} active positions</div>
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
            <div className="text-xs text-zinc-400 flex items-center justify-between mb-1">
              <span>3. Shielded Earn & Vaults</span>
              <Layers className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-lg font-bold text-white">
              ${earnDepositsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{userDeposits.length} active vaults</div>
          </div>
        </div>
      </div>

      {/* Asset Breakdown Table */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-zinc-200 mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          Shielded Holdings & Note Details
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 pb-2">
              <tr>
                <th className="py-2.5 px-3">Asset</th>
                <th className="py-2.5 px-3">Public Balance</th>
                <th className="py-2.5 px-3">Shielded UTXO Balance</th>
                <th className="py-2.5 px-3">Shielded Value</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/40">
              {balances.map((b) => {
                const price = tokenPrices[b.token.symbol] || 0;
                const pubAmt = Number(b.publicBalance) / 10 ** b.token.decimals;
                const shldAmt = Number(b.shieldedBalance) / 10 ** b.token.decimals;
                const valUsd = shldAmt * price;

                return (
                  <tr key={b.token.symbol} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-xs text-zinc-200">
                          {b.token.symbol.substring(0, 1)}
                        </div>
                        <div>
                          <div className="font-semibold text-zinc-100">{b.token.symbol}</div>
                          <div className="text-[10px] text-zinc-500">{b.token.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-zinc-400 font-mono">
                      {pubAmt.toFixed(4)} {b.token.symbol}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-purple-300">
                      {shldAmt.toFixed(4)} {b.token.symbol}
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold text-zinc-200">
                      ${valUsd.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right space-x-1.5">
                      <button
                        onClick={() => onNavigateTab('SHIELD')}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] text-purple-300 border border-purple-500/20"
                      >
                        Shield
                      </button>
                      <button
                        onClick={() => onNavigateTab('SWAP')}
                        className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 border border-zinc-700"
                      >
                        Swap
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
