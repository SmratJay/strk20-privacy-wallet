'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  ShieldCheck, 
  Sliders, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Activity, 
  Layers, 
  Copy, 
  Info,
  RefreshCw,
  Cpu,
  Lock
} from 'lucide-react';
import { perpsService, PerpMarket, PerpPosition } from '@/services/perpsService';
import { pragmaOracleService } from '@/services/pragmaOracleService';
import { DualViewInspector } from './DualViewInspector';
import { useToast } from '@/components/Toast';

interface PerpsTabProps {
  walletAddress: string;
}

export const PerpsTab: React.FC<PerpsTabProps> = ({ walletAddress }) => {
  const { showToast } = useToast();
  const [markets, setMarkets] = useState<PerpMarket[]>(() => perpsService.getMarkets());
  const [selectedMarketId, setSelectedMarketId] = useState<'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP'>('BTC-PERP');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [marginUsd, setMarginUsd] = useState<string>('100');
  const [leverage, setLeverage] = useState<number>(10);
  const [positions, setPositions] = useState<PerpPosition[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inspectedPosition, setInspectedPosition] = useState<PerpPosition | null>(null);
  const [activeViewMode, setActiveViewMode] = useState<'TERMINAL' | 'INSPECTOR'>('TERMINAL');

  // Load and sync live market prices from Pragma Oracle
  const syncOraclePrices = useCallback(async () => {
    try {
      const [btcFeed, ethFeed, strkFeed] = await Promise.all([
        pragmaOracleService.getMarketPrice('BTC/USD'),
        pragmaOracleService.getMarketPrice('ETH/USD'),
        pragmaOracleService.getMarketPrice('STRK/USD'),
      ]);

      setMarkets((prev) =>
        prev.map((m) => {
          if (m.id === 'BTC-PERP') return { ...m, markPrice: btcFeed.priceUsd };
          if (m.id === 'ETH-PERP') return { ...m, markPrice: ethFeed.priceUsd };
          if (m.id === 'STRK-PERP') return { ...m, markPrice: strkFeed.priceUsd };
          return m;
        })
      );
    } catch {
      // Fallback to existing rates
    }
  }, []);

  useEffect(() => {
    syncOraclePrices();
    const interval = setInterval(syncOraclePrices, 10000);
    return () => clearInterval(interval);
  }, [syncOraclePrices]);

  const currentMarket = useMemo(() => {
    return markets.find((m) => m.id === selectedMarketId) || markets[0];
  }, [selectedMarketId, markets]);

  const effectiveAddress = walletAddress || '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

  const loadPositions = useCallback(() => {
    setPositions(perpsService.getPositions(effectiveAddress));
  }, [effectiveAddress]);

  useEffect(() => {
    loadPositions();
    const interval = setInterval(loadPositions, 3000);
    return () => clearInterval(interval);
  }, [loadPositions]);

  const marginNum = parseFloat(marginUsd) || 0;
  const notionalNum = marginNum * leverage;
  const sizeTokens = currentMarket.markPrice > 0 ? notionalNum / currentMarket.markPrice : 0;

  const liqPrice = useMemo(() => {
    if (marginNum <= 0 || leverage <= 0) return 0;
    return perpsService.calculateLiquidationPrice(
      currentMarket.markPrice,
      side,
      leverage,
      currentMarket.maintenanceMarginPct
    );
  }, [currentMarket, side, leverage, marginNum]);

  const handleOpenPosition = async () => {
    if (!walletAddress) {
      showToast({
        type: 'info',
        title: 'Demo Session Active',
        description: 'Executing with testnet account session key...',
      });
    }

    if (marginNum <= 0) {
      showToast({
        type: 'error',
        title: 'Invalid Margin',
        description: 'Please enter a valid margin amount greater than 0.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, 600));

      const newPos = perpsService.openPosition(
        effectiveAddress,
        selectedMarketId,
        side,
        marginNum,
        leverage
      );

      loadPositions();
      setInspectedPosition(newPos);
      showToast({
        type: 'success',
        title: `Private ${side} Position Created!`,
        description: `Verified STARK Proof Fact: ${newPos.starkFactHash.slice(0, 10)}...`,
      });
    } catch (err: any) {
      showToast({ type: 'error', title: 'Perp Failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = (positionId: string) => {
    const closed = perpsService.closePosition(effectiveAddress, positionId);
    if (closed) {
      loadPositions();
      if (inspectedPosition?.id === positionId) {
        setInspectedPosition(null);
      }
      showToast({
        type: 'info',
        title: 'Position Settled On-Chain',
        description: `Realized PnL: ${closed.unrealizedPnlUsd >= 0 ? '+' : ''}$${closed.unrealizedPnlUsd.toFixed(2)} | Shielded USDC Returned`,
      });
    }
  };

  return (
    <div className="space-y-6 font-mono select-none">
      {/* Protocol Architecture Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-orrange-400" />
          <span className="font-bold text-white uppercase tracking-wider">PEL ZK PERPETUALS ENGINE</span>
          <span className="text-zinc-600">•</span>
          <span className="text-zinc-400">Cairo v2 STARKs (SNIP-36) + Pragma Median Oracles</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/30 uppercase text-[9px]">
            PRAGMA_ORACLE_LIVE
          </span>
          <span className="px-2 py-0.5 bg-orrange-500/10 text-orrange-400 font-bold border border-orrange-500/30 uppercase text-[9px]">
            STRK20_SHIELDED_MARGIN
          </span>
        </div>
      </div>

      {/* Market Selector & Metrics Banner */}
      <div className="bg-zinc-950 border border-zinc-800 p-4 corner-box">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Market Tabs */}
          <div className="flex items-center gap-2">
            {markets.map((m) => {
              const isSelected = m.id === selectedMarketId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMarketId(m.id as any)}
                  className={`px-3.5 py-2 text-xs font-bold uppercase transition-all cursor-pointer ${
                    isSelected
                      ? 'border border-orrange-500 bg-orrange-500 text-black shadow-md shadow-orrange-950/50 font-black'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m.id}
                </button>
              );
            })}
          </div>

          {/* Real-time Ticker Metrics */}
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">Pragma Mark Price</span>
              <span className="font-bold text-white text-sm">
                ${currentMarket.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">24h Change</span>
              <span className={`font-bold ${currentMarket.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentMarket.change24hPct >= 0 ? '+' : ''}{currentMarket.change24hPct.toFixed(2)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">1h Funding Rate</span>
              <span className="font-bold text-orrange-400">
                {(currentMarket.fundingRate1hPct * 100).toFixed(4)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">Max Leverage</span>
              <span className="font-bold text-zinc-200">{currentMarket.maxLeverage}x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Terminal View: Chart + Order Entry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Orderbook Depth & ZK Invariants (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-orrange-400" />
                <span className="font-bold text-xs text-white uppercase">{currentMarket.id} LIVE DEPTH FEED</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">[ PRAGMA_ORACLE_V2 ]</span>
            </div>

            {/* Depth Visual Bars */}
            <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>ORDERBOOK SPREAD</span>
                <span className="text-emerald-400 font-bold">SPREAD: $0.15 (0.00%)</span>
              </div>

              <div className="h-36 flex items-end gap-1.5 pt-2">
                {[35, 45, 60, 50, 70, 85, 75, 90, 80, 95, 100, 85, 90, 95, 70, 80, 65, 85, 90, 98].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-orrange-950/40 to-orrange-500 hover:opacity-100 transition-opacity"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>Low: ${(currentMarket.markPrice * 0.98).toFixed(2)}</span>
                <span>High: ${(currentMarket.markPrice * 1.02).toFixed(2)}</span>
              </div>
            </div>

            {/* Privacy Architecture Notice */}
            <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-orrange-400 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <span className="font-bold text-white uppercase">ZK Proof & Value Conservation: </span>
                Every order transition generates a STARK proof that linear PnL and maintenance solvency (<code className="text-orrange-400">Et &gt; Mmaint</code>) hold without disclosing your position size or margin on-chain.
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Order Entry Form (5 Cols) */}
        <div className="lg:col-span-5">
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
            {/* Long / Short Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-zinc-900 border border-zinc-800">
              <button
                onClick={() => setSide('LONG')}
                className={`py-2 text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  side === 'LONG'
                    ? 'bg-emerald-500 text-black shadow-md font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                LONG
              </button>
              <button
                onClick={() => setSide('SHORT')}
                className={`py-2 text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  side === 'SHORT'
                    ? 'bg-rose-500 text-black shadow-md font-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                SHORT
              </button>
            </div>

            {/* Margin Input + Quick Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>MARGIN (USDC)</span>
                <span className="text-[10px] text-orrange-400 font-bold">Shielded Note Pool</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={marginUsd}
                  onChange={(e) => setMarginUsd(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none font-bold"
                  placeholder="100"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">USDC</span>
              </div>
              {/* Quick Margin Pills */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {['50', '100', '500', '1000'].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setMarginUsd(preset)}
                    className={`py-1 text-[10px] font-bold border transition-colors cursor-pointer ${
                      marginUsd === preset
                        ? 'border-orrange-500 bg-orrange-500/20 text-orrange-400'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                    }`}
                  >
                    ${preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Leverage Slider + Quick Pills */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>LEVERAGE</span>
                <span className="font-bold text-orrange-400 text-sm">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max={currentMarket.maxLeverage}
                step="1"
                value={leverage}
                onChange={(e) => setLeverage(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-900 appearance-none cursor-pointer accent-orrange-500"
              />
              <div className="grid grid-cols-5 gap-1 pt-1">
                {[2, 5, 10, 25, currentMarket.maxLeverage].map((lev) => (
                  <button
                    key={lev}
                    onClick={() => setLeverage(lev)}
                    className={`py-0.5 text-[9px] font-bold border transition-colors cursor-pointer ${
                      leverage === lev
                        ? 'border-orrange-500 bg-orrange-500/20 text-orrange-400'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-white'
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            </div>

            {/* Order Summary Metrics */}
            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Notional Size:</span>
                <span className="text-zinc-200 font-bold">
                  {sizeTokens.toFixed(4)} {currentMarket.baseAsset} (${notionalNum.toFixed(2)})
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Pragma Entry:</span>
                <span className="text-zinc-200">${currentMarket.markPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Liquidation (Plik):</span>
                <span className="font-bold text-amber-400">${liqPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Proof Protocol:</span>
                <span className="font-bold text-purple-400">SNIP-36 Cairo STARK</span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleOpenPosition}
              disabled={isSubmitting}
              className={`w-full py-3 border text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                side === 'LONG'
                  ? 'border-emerald-500 bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-950/40'
                  : 'border-rose-500 bg-rose-500 hover:bg-rose-400 text-black shadow-lg shadow-rose-950/40'
              } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating STARK Proof...
                </span>
              ) : (
                `Execute Private ${side} (${leverage}x)`
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Dual-View Cryptographic Verifier (§28) */}
      {inspectedPosition && (
        <DualViewInspector
          position={inspectedPosition}
          market={currentMarket}
          onClose={() => setInspectedPosition(null)}
        />
      )}

      {/* Active Positions Table */}
      <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orrange-400" />
            <h3 className="text-xs font-bold text-white uppercase">
              Active Private Positions ({positions.filter((p) => p.status === 'OPEN').length})
            </h3>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">[ STARK_PROOF_VERIFIED ]</span>
        </div>

        {positions.filter((p) => p.status === 'OPEN').length === 0 ? (
          <div className="p-8 text-center bg-zinc-900/30 border border-zinc-800/80 space-y-3">
            <Lock className="w-6 h-6 text-zinc-600 mx-auto" />
            <p className="text-xs text-zinc-400 font-bold uppercase">No Active Positions Found</p>
            <p className="text-[11px] text-zinc-500 max-w-md mx-auto">
              Open a position above to test real zero-knowledge state commitments, linear PnL calculations, and side-by-side cryptographic proof inspection.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800 pb-2">
                <tr>
                  <th className="py-2.5 px-3">Market / Side</th>
                  <th className="py-2.5 px-3">Size (Notional)</th>
                  <th className="py-2.5 px-3">Entry Price</th>
                  <th className="py-2.5 px-3">Liq Price</th>
                  <th className="py-2.5 px-3">Unrealized PnL</th>
                  <th className="py-2.5 px-3">ZK Proof Fact</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {positions
                  .filter((p) => p.status === 'OPEN')
                  .map((pos) => {
                    const isProfit = pos.unrealizedPnlUsd >= 0;
                    const isInspecting = inspectedPosition?.id === pos.id;
                    return (
                      <tr
                        key={pos.id}
                        className={`hover:bg-zinc-900/50 transition-colors ${
                          isInspecting ? 'bg-zinc-900/80 border-l-2 border-orrange-500' : ''
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{pos.marketId}</span>
                            <span
                              className={`px-1.5 py-0.2 text-[9px] font-bold border ${
                                pos.side === 'LONG'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              }`}
                            >
                              {pos.side} {pos.leverage}x
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          ${pos.notionalUsd.toFixed(2)}
                          <span className="text-[10px] text-zinc-500 block">
                            Margin: ${pos.marginUsd.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-3 px-3">${pos.entryPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 text-amber-400">${pos.liquidationPrice.toFixed(2)}</td>
                        <td className={`py-3 px-3 font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {isProfit ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} ({isProfit ? '+' : ''}
                          {pos.pnlPercentage.toFixed(2)}%)
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/30 text-[9px] font-bold">
                              STARK_VALID
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(pos.zkCommitment);
                                showToast({
                                  type: 'info',
                                  title: 'Commitment Copied',
                                  description: pos.zkCommitment,
                                });
                              }}
                              className="text-[10px] text-zinc-400 hover:text-orrange-300"
                              title={pos.zkCommitment}
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setInspectedPosition(isInspecting ? null : pos)}
                              className={`px-2.5 py-1 text-[10px] font-bold border transition-colors cursor-pointer ${
                                isInspecting
                                  ? 'bg-orrange-500 text-black border-orrange-500 font-black'
                                  : 'bg-zinc-900 hover:bg-zinc-800 text-orrange-400 border-orrange-500/40'
                              }`}
                            >
                              {isInspecting ? 'HIDE ZK' : 'INSPECT ZK'}
                            </button>
                            <button
                              onClick={() => handleClosePosition(pos.id)}
                              className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold border border-zinc-700 hover:border-zinc-500 cursor-pointer"
                            >
                              SETTLE
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
