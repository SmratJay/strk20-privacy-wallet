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
import { pelLiquidityService } from '@/services/pelLiquidityService';

import { priceService } from '@/services/priceService';

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
  const [tokenPrices, setTokenPrices] = React.useState<Record<string, number>>(() => ({
    ...priceService.getCachedPrices(),
  }));
  // Real on-chain LP counterparty position value (PELLiquidityVault), NOT a simulated
  // earn vault. null = unavailable/not deployed; 0 = no LP position.
  const [lpValueUsd, setLpValueUsd] = React.useState<number | null>(null);

  React.useEffect(() => {
    priceService.getPrices().then((prices) => {
      setTokenPrices({ ...prices });
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metrics, shares] = await Promise.all([
          pelLiquidityService.fetchPoolMetrics(),
          walletAddress ? pelLiquidityService.fetchLpShares(walletAddress) : Promise.resolve(0n),
        ]);
        if (cancelled) return;
        // On-chain get_share_price_e6 returns USD-per-raw-share * 1e12 (see lpVault.ts /
        // pel_liquidity_vault.cairo). True LP value = shares * sharePriceE6 / 1e12.
        const valueUsd = (Number(shares) * Number(metrics.sharePriceE6)) / 1_000_000_000_000;
        setLpValueUsd(valueUsd);
      } catch {
        if (!cancelled) setLpValueUsd(null); // vault unavailable -> fail closed, no fabricated value
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  // 1. Calculate Shielded Cash Value
  const shieldedCashUsd = useMemo(() => {
    return balances.reduce((acc, b) => {
      const price = tokenPrices[b.token.symbol] || 0;
      const amount = Number(b.shieldedBalance) / 10 ** b.token.decimals;
      return acc + amount * price;
    }, 0);
  }, [balances, tokenPrices]);

  // 2. Calculate Public Balance Value (excludes tokens whose balance could not be
  // fetched — an unreachable RPC must never count as a $0 balance)
  const publicCashUsd = useMemo(() => {
    return balances.reduce((acc, b) => {
      if (b.publicBalanceAvailable === false) return acc;
      const price = tokenPrices[b.token.symbol] || 0;
      const amount = Number(b.publicBalance) / 10 ** b.token.decimals;
      return acc + amount * price;
    }, 0);
  }, [balances, tokenPrices]);

  // 3. Calculate Perp Position Margin & Equity
  const perpPositions = useMemo(() => {
    return walletAddress ? perpsService.getPositions(walletAddress).filter(p => p.status === 'OPEN') : [];
  }, [walletAddress]);

  const perpEquityUsd = useMemo(() => {
    return perpPositions.reduce((acc, p) => acc + p.marginUsd + p.unrealizedPnlUsd, 0);
  }, [perpPositions]);

  // 4. Calculate real LP counterparty vault value (PELLiquidityVault). Never fabricated.
  const earnDepositsUsd = lpValueUsd ?? 0;

  // Total Private Net Worth: NetWorth = sum(Value(Ni)) + sum(Equity(Posj)) + sum(Value(Vaultk))
  const privateNetWorthUsd = shieldedCashUsd + perpEquityUsd + earnDepositsUsd;
  const totalCombinedNetWorth = privateNetWorthUsd + publicCashUsd;
  const privacyRatio = totalCombinedNetWorth > 0 ? (privateNetWorthUsd / totalCombinedNetWorth) * 100 : 0;

  return (
    <div className="space-y-6 font-mono">
      {/* Top Banner: Total Net Worth Breakdown */}
      <div className="bg-zinc-950 border border-orrange-500/50 p-6 corner-box shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-orrange-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-orrange-400 uppercase tracking-wider mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orrange-500 animate-pulse" />
              <span>TOTAL PRIVATE NET WORTH // PEL SUBSTRATE</span>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight flex items-baseline gap-3">
              ${privateNetWorthUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-bold px-2 py-0.5 bg-orrange-950/70 border border-orrange-500/50 text-orrange-300">
                {privacyRatio.toFixed(0)}% SHIELDED
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Formula: ∑ Value(Notes) + ∑ Equity(Perps) + ∑ Value(Vaults)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigateTab('SWAP')}
              className="px-4 py-2 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black text-xs font-black tracking-wider uppercase transition-all cursor-pointer shadow-lg shadow-orrange-950/40"
            >
              Trade Router
            </button>
            <button
              onClick={() => onNavigateTab('SHIELD')}
              className="px-4 py-2 border border-zinc-800 hover:border-orrange-500/60 bg-zinc-900 text-zinc-300 hover:text-white text-xs font-bold tracking-wider uppercase transition-all cursor-pointer"
            >
              Deposit Notes
            </button>
          </div>
        </div>

        {/* 3 Sub-component Balance Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-6 border-t border-zinc-900">
          <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 hover:border-orrange-500/40 transition-all">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between font-bold">
              <span>1. Shielded Cash Notes</span>
              <Lock className="w-3 h-3 text-orrange-400" />
            </div>
            <div className="text-lg font-bold text-white mt-1">
              ${shieldedCashUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-orrange-400 mt-0.5 font-bold uppercase">[ UTXO ENCRYPTED ]</div>
          </div>

          <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 hover:border-orrange-500/40 transition-all">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between font-bold">
              <span>2. Active Perp Equity</span>
              <TrendingUp className="w-3 h-3 text-orrange-400" />
            </div>
            <div className="text-lg font-bold text-white mt-1">
              ${perpEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-orrange-400 mt-0.5 font-bold uppercase">
              [ {perpPositions.length} {perpPositions.length === 1 ? 'POSITION' : 'POSITIONS'} // ZK COMMITTED ]
            </div>
          </div>

          <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 hover:border-orrange-500/40 transition-all">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between font-bold">
              <span>3. LP Counterparty Position</span>
              <Layers className="w-3 h-3 text-orrange-400" />
            </div>
            <div className="text-lg font-bold text-white mt-1">
              ${earnDepositsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-orrange-400 mt-0.5 font-bold uppercase">
              [ {lpValueUsd === null ? 'LP VAULT UNAVAILABLE' : 'PELLiquidityVault' } ]
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Assets Table & Open Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Shielded Assets Table */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <PieChart className="w-4 h-4 text-orrange-400" />
              <span>Shielded Asset Allocations</span>
            </h3>
            <span className="text-[10px] text-zinc-500 font-bold">[ POSEIDON_STORAGE ]</span>
          </div>

          <div className="space-y-2">
            {balances.map((b) => {
              const price = tokenPrices[b.token.symbol] || 0;
              const shieldedAmount = Number(b.shieldedBalance) / 10 ** b.token.decimals;
              const shieldedValueUsd = shieldedAmount * price;

              return (
                <div 
                  key={b.token.symbol} 
                  className="p-3 bg-zinc-900/50 border border-zinc-800/80 hover:border-orrange-500/50 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{b.token.icon}</span>
                    <div>
                      <div className="text-xs font-bold text-white">{b.token.symbol}</div>
                      <div className="text-[10px] text-zinc-500">${price.toLocaleString()} USD</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-orrange-400">
                      {shieldedAmount.toFixed(4)} {b.token.symbol}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      ${shieldedValueUsd.toFixed(2)} USD
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Route & Perpetual Overview */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-orrange-400" />
                <span>Live Derivatives Status</span>
              </h3>
              <span className="text-[10px] text-orrange-400 font-bold">[ 50X_LEVERAGE ]</span>
            </div>

            {perpPositions.length > 0 ? (
              <div className="space-y-2">
                {perpPositions.map((pos) => (
                  <div key={pos.id} className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs">
                    <div className="flex items-center justify-between font-bold text-white">
                      <span>{pos.marketId} ({pos.side})</span>
                      <span className={pos.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1 flex justify-between">
                      <span>Margin: ${pos.marginUsd}</span>
                      <span>Liq: ${pos.liquidationPrice.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center border border-dashed border-zinc-800 bg-zinc-900/30 text-zinc-500 text-xs">
                No active leveraged positions.
                <button
                  onClick={() => onNavigateTab('PERPS')}
                  className="mt-3 block mx-auto text-orrange-400 hover:underline font-bold text-[11px] uppercase cursor-pointer"
                >
                  Open 1x-50x Perp →
                </button>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-900 text-[10px] text-zinc-500 flex items-center justify-between">
            <span>PEL_ROUTER // OPTIMIZED</span>
            <span className="text-orrange-400 font-bold">100% PRIVATE</span>
          </div>
        </div>
      </div>
    </div>
  );
};
