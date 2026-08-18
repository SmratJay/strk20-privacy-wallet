'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Info
} from 'lucide-react';
import { perpsService, PerpMarket, PerpPosition } from '@/services/perpsService';
import { useToast } from '@/components/Toast';

interface PerpsTabProps {
  walletAddress: string;
}

export const PerpsTab: React.FC<PerpsTabProps> = ({ walletAddress }) => {
  const { showToast } = useToast();
  const markets = useMemo(() => perpsService.getMarkets(), []);
  const [selectedMarketId, setSelectedMarketId] = useState<'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP'>('BTC-PERP');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [marginUsd, setMarginUsd] = useState<string>('100');
  const [leverage, setLeverage] = useState<number>(10);
  const [positions, setPositions] = useState<PerpPosition[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentMarket = useMemo(() => {
    return perpsService.getMarket(selectedMarketId) || markets[0];
  }, [selectedMarketId, markets]);

  const loadPositions = () => {
    if (!walletAddress) return;
    setPositions(perpsService.getPositions(walletAddress));
  };

  useEffect(() => {
    loadPositions();
    const interval = setInterval(loadPositions, 3000);
    return () => clearInterval(interval);
  }, [walletAddress]);

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
        type: 'error',
        title: 'Wallet Not Connected',
        description: 'Please connect your Starknet wallet to trade perpetuals.',
      });
      return;
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
        walletAddress,
        selectedMarketId,
        side,
        marginNum,
        leverage
      );

      loadPositions();
      showToast({
        type: 'success',
        title: `Private ${side} Opened!`,
        description: `Committed ZK Hash: ${newPos.zkCommitment.slice(0, 10)}...`,
      });
    } catch (err: any) {
      showToast({ type: 'error', title: 'Perp Failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = (positionId: string) => {
    if (!walletAddress) return;
    const closed = perpsService.closePosition(walletAddress, positionId);
    if (closed) {
      loadPositions();
      showToast({
        type: 'info',
        title: 'Position Closed',
        description: `Realized PnL: ${closed.unrealizedPnlUsd >= 0 ? '+' : ''}$${closed.unrealizedPnlUsd.toFixed(2)}`,
      });
    }
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Protocol Badge */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-orrange-400" />
          <span className="font-bold text-zinc-200">ZK PRIVATE DERIVATIVES ENGINE</span>
          <span className="text-zinc-500">•</span>
          <span>Poseidon Commitments (WP §7.3) & Risk Invariants (App. A)</span>
        </div>
        <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 uppercase">
          ALPHA SIMULATION HARNESS
        </span>
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
                  className={`px-3 py-1.5 text-xs font-bold uppercase transition-all ${
                    isSelected
                      ? 'border border-orrange-500 bg-orrange-500 text-black'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m.id}
                </button>
              );
            })}
          </div>

          {/* Real-time Ticker Metrics */}
          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">Mark Price</span>
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
              <span className="text-[10px] text-zinc-500 block uppercase">1h Funding</span>
              <span className="font-bold text-orrange-400">
                {(currentMarket.fundingRate1hPct * 100).toFixed(4)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase">Max Leverage</span>
              <span className="font-bold text-zinc-300">{currentMarket.maxLeverage}x</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Terminal View: Chart + Order Book + Order Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Dynamic Chart & State (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-orrange-400" />
                <span className="font-bold text-xs text-white uppercase">{currentMarket.id} MARKET FEED</span>
              </div>
              <span className="text-[10px] text-zinc-500">[ PARADEX_ZK_ENGINE ]</span>
            </div>

            {/* Mock Candlestick / Depth Bars */}
            <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>ORDERBOOK DEPTH</span>
                <span className="text-emerald-400 font-bold">SPREAD: $0.20 (0.00%)</span>
              </div>

              <div className="h-40 flex items-end gap-1.5 pt-4">
                {[35, 45, 60, 50, 70, 85, 75, 90, 80, 95, 100, 85, 90, 95, 70, 80, 65, 85, 90, 98].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-orrange-950/40 to-orrange-500 hover:opacity-100 transition-opacity"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>Low: ${(currentMarket.markPrice * 0.97).toFixed(2)}</span>
                <span>High: ${(currentMarket.markPrice * 1.03).toFixed(2)}</span>
              </div>
            </div>

            {/* Privacy Architecture Notice */}
            <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-orrange-400 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <span className="font-bold text-white uppercase">ZK Position Commitment: </span>
                Positions, margins, and liquidation levels are hashed into Poseidon state commitments. 
                Liquidations verify <code className="text-orrange-400">Et ≤ Mmaint</code> via ZK proofs without revealing user leverage.
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
                className={`py-2 text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  side === 'LONG'
                    ? 'bg-emerald-500 text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                LONG
              </button>
              <button
                onClick={() => setSide('SHORT')}
                className={`py-2 text-xs font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${
                  side === 'SHORT'
                    ? 'bg-rose-500 text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                SHORT
              </button>
            </div>

            {/* Margin Input */}
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                <span>MARGIN (USD)</span>
                <span className="text-[10px] text-zinc-500">Shielded Balance</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={marginUsd}
                  onChange={(e) => setMarginUsd(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                  placeholder="100"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">USD</span>
              </div>
            </div>

            {/* Leverage Slider */}
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
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
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                <span>1x</span>
                <span>10x</span>
                <span>25x</span>
                <span>{currentMarket.maxLeverage}x Max</span>
              </div>
            </div>

            {/* Order Summary Metrics */}
            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Position Size:</span>
                <span className="text-zinc-200">
                  {sizeTokens.toFixed(4)} {currentMarket.baseAsset} (${notionalNum.toFixed(2)})
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Entry Price:</span>
                <span className="text-zinc-200">${currentMarket.markPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Est. Liq. Price:</span>
                <span className="font-bold text-amber-400">${liqPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Execution Route:</span>
                <span className="font-bold text-orrange-400">Paradex + STRK20 Vault</span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleOpenPosition}
              disabled={isSubmitting}
              className={`w-full py-3 border text-xs font-black uppercase tracking-wider transition-all ${
                side === 'LONG'
                  ? 'border-emerald-500 bg-emerald-500 hover:bg-emerald-400 text-black'
                  : 'border-rose-500 bg-rose-500 hover:bg-rose-400 text-black'
              } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? 'Generating ZK Commitment...' : `Open Private ${side} (${leverage}x)`}
            </button>
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="bg-zinc-950 border border-zinc-800 p-5 corner-box">
        <h3 className="text-xs font-bold text-white uppercase mb-4 flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orrange-400" />
            <span>Active Private Positions ({positions.filter(p => p.status === 'OPEN').length})</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-normal">[ STATE_DIFFS_ENCRYPTED ]</span>
        </h3>

        {positions.filter(p => p.status === 'OPEN').length === 0 ? (
          <div className="text-center py-10 text-zinc-500 text-xs">
            No active perpetual positions found. Open a position above to trade with cryptographic leverage!
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
                  <th className="py-2.5 px-3">ZK Commitment</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {positions.filter(p => p.status === 'OPEN').map((pos) => {
                  const isProfit = pos.unrealizedPnlUsd >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-zinc-900/50 transition-colors">
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
                        <span className="text-[10px] text-zinc-500 block">Margin: ${pos.marginUsd.toFixed(2)}</span>
                      </td>
                      <td className="py-3 px-3">${pos.entryPrice.toFixed(2)}</td>
                      <td className="py-3 px-3 text-amber-400">${pos.liquidationPrice.toFixed(2)}</td>
                      <td className={`py-3 px-3 font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} ({isProfit ? '+' : ''}{pos.pnlPercentage.toFixed(2)}%)
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(pos.zkCommitment);
                            showToast({ type: 'info', title: 'Commitment Copied', description: pos.zkCommitment });
                          }}
                          className="flex items-center gap-1 text-[10px] text-orrange-400 hover:text-orrange-300"
                        >
                          <span className="truncate max-w-[90px]">{pos.zkCommitment.substring(0, 10)}...</span>
                          <Copy className="w-3 h-3" />
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleClosePosition(pos.id)}
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold border border-zinc-700"
                        >
                          CLOSE
                        </button>
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
