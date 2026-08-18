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
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [positions, setPositions] = useState<PerpPosition[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentMarket = useMemo(() => {
    return perpsService.getMarket(selectedMarketId) || markets[0];
  }, [selectedMarketId, markets]);

  // Refresh positions
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
      // Simulate ZK proof witness generation and execution
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
        description: `Position commitment ${newPos.zkCommitment.substring(0, 10)}... registered to ZK pool.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Execution Failed',
        description: err.message || 'Could not open position.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = (posId: string) => {
    const closed = perpsService.closePosition(walletAddress, posId);
    if (closed) {
      loadPositions();
      showToast({
        type: 'info',
        title: 'Position Closed',
        description: 'Collateral and realized PnL settled back to shielded balance.',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Ticker Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {markets.map((m) => {
          const isSelected = m.id === selectedMarketId;
          const isPositive = m.change24hPct >= 0;
          return (
            <button
              key={m.id}
              onClick={() => setSelectedMarketId(m.id)}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                isSelected
                  ? 'bg-zinc-900 border-purple-500/60 shadow-lg shadow-purple-950/20'
                  : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-zinc-100">{m.id}</span>
                <span className={`text-xs font-semibold flex items-center gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {isPositive ? '+' : ''}{m.change24hPct}%
                </span>
              </div>
              <div className="text-lg font-extrabold text-white mt-1">
                ${m.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                <span>1h Funding: {(m.fundingRate1hPct * 100).toFixed(4)}%</span>
                <span>Vol: ${(m.volume24hUsd / 1e6).toFixed(1)}M</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Trading Terminal: Chart & Order Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Market Overview & Terminal (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-zinc-900/70 border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center font-bold text-purple-300">
                  {currentMarket.baseAsset}
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-100">{currentMarket.id}</h3>
                  <p className="text-xs text-zinc-500">Starknet Private Perpetual Derivative</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-zinc-300">
                  Index: ${currentMarket.indexPrice.toLocaleString()}
                </div>
                <div className="text-[11px] text-purple-400 flex items-center gap-1 justify-end">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Paradex Private RPC Layer
                </div>
              </div>
            </div>

            {/* Simulated Live Sparkline / Market Depth */}
            <div className="h-44 my-4 rounded-xl bg-zinc-950/60 border border-zinc-800/50 p-4 flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono">Real-time ZK Orderbook Depth</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">
                  Spread: 0.01%
                </span>
              </div>
              
              {/* Visual Candlestick Wave */}
              <div className="flex items-end gap-1.5 h-24 pt-4 px-2">
                {[35, 45, 40, 55, 60, 52, 68, 75, 70, 85, 90, 82, 88, 95, 92, 100].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-purple-600/30 to-purple-400 rounded-t-sm hover:opacity-100 transition-opacity"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                <span>Low: ${(currentMarket.markPrice * 0.97).toFixed(2)}</span>
                <span>High: ${(currentMarket.markPrice * 1.03).toFixed(2)}</span>
              </div>
            </div>

            {/* Privacy Architecture Notice */}
            <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-zinc-300 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-purple-300">Confidential Position Architecture: </span>
                Positions, entry prices, leverage, and liquidation levels are committed via Poseidon STARK hashes. 
                Liquidations evaluate the inequality <code className="text-purple-300">Et ≤ Mmaint</code> via ZK proofs without revealing collateral size.
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Order Entry Form (5 Cols) */}
        <div className="lg:col-span-5">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-2xl space-y-4">
            {/* Long / Short Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-zinc-950 border border-zinc-800">
              <button
                onClick={() => setSide('LONG')}
                className={`py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  side === 'LONG'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                LONG
              </button>
              <button
                onClick={() => setSide('SHORT')}
                className={`py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  side === 'SHORT'
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-950/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                SHORT
              </button>
            </div>

            {/* Margin Input */}
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                <span>Margin (USD)</span>
                <span className="text-[11px] text-zinc-500">Shielded USDC / STRK</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={marginUsd}
                  onChange={(e) => setMarginUsd(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500 text-white text-sm font-mono outline-none"
                  placeholder="100"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-400">USD</span>
              </div>
            </div>

            {/* Leverage Slider */}
            <div>
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
                <span>Leverage</span>
                <span className="font-bold text-purple-300 text-sm font-mono">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max={currentMarket.maxLeverage}
                step="1"
                value={leverage}
                onChange={(e) => setLeverage(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                <span>1x</span>
                <span>10x</span>
                <span>25x</span>
                <span>{currentMarket.maxLeverage}x Max</span>
              </div>
            </div>

            {/* Order Summary Metrics */}
            <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Position Size:</span>
                <span className="font-mono text-zinc-200">
                  {sizeTokens.toFixed(4)} {currentMarket.baseAsset} (${notionalNum.toFixed(2)})
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Entry Price:</span>
                <span className="font-mono text-zinc-200">${currentMarket.markPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Est. Liq. Price:</span>
                <span className="font-mono font-bold text-amber-400">${liqPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Execution Route:</span>
                <span className="font-semibold text-purple-300">Paradex + STRK20 Vault</span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleOpenPosition}
              disabled={isSubmitting}
              className={`w-full py-3 rounded-xl text-sm font-bold text-white shadow-xl transition-all ${
                side === 'LONG'
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/30'
                  : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/30'
              } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSubmitting ? 'Generating ZK Commitment...' : `Open Private ${side} (${leverage}x)`}
            </button>
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-zinc-200 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" />
            <span>Active Private Positions ({positions.filter(p => p.status === 'OPEN').length})</span>
          </div>
          <span className="text-[11px] text-zinc-500 font-normal">State diffs encrypted in local vault</span>
        </h3>

        {positions.filter(p => p.status === 'OPEN').length === 0 ? (
          <div className="text-center py-10 text-zinc-500 text-xs">
            No active perpetual positions found. Open a position above to trade with cryptographic leverage!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="text-[11px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800/80 pb-2">
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
              <tbody className="divide-y divide-zinc-800/40">
                {positions.filter(p => p.status === 'OPEN').map((pos) => {
                  const isProfit = pos.unrealizedPnlUsd >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-100">{pos.marketId}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pos.side === 'LONG'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {pos.side} {pos.leverage}x
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        ${pos.notionalUsd.toFixed(2)}
                        <span className="text-[10px] text-zinc-500 block">Margin: ${pos.marginUsd.toFixed(2)}</span>
                      </td>
                      <td className="py-3 px-3 font-mono">${pos.entryPrice.toFixed(2)}</td>
                      <td className="py-3 px-3 font-mono text-amber-400">${pos.liquidationPrice.toFixed(2)}</td>
                      <td className={`py-3 px-3 font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} ({isProfit ? '+' : ''}{pos.pnlPercentage.toFixed(2)}%)
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(pos.zkCommitment);
                            showToast({ type: 'info', title: 'Commitment Copied', description: pos.zkCommitment });
                          }}
                          className="flex items-center gap-1 font-mono text-[10px] text-purple-400 hover:text-purple-300"
                        >
                          <span className="truncate max-w-[90px]">{pos.zkCommitment.substring(0, 10)}...</span>
                          <Copy className="w-3 h-3" />
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handleClosePosition(pos.id)}
                          className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-semibold border border-zinc-700"
                        >
                          Close
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
