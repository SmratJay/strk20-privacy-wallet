'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Flame,
  Layers,
  Lock,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Loader2,
} from 'lucide-react';
import { useExtended } from '@/hooks/useExtended';
import type { Position } from '@/extended/types';

const fmt = (v: string | number | undefined, dp = 2): string => {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const signed = (v: string | undefined, dp = 2): string => {
  const n = Number(v ?? 0);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmt(v, dp)}`;
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">{label}</div>
      <div className={`text-sm font-bold font-mono truncate ${accent ?? 'text-zinc-100'}`}>{value}</div>
    </div>
  );
}

export default function ExtendedPage() {
  const ext = useExtended();
  const [showConnect, setShowConnect] = useState(false);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [qty, setQty] = useState('0.001');
  const [price, setPrice] = useState('');
  const [accountTab, setAccountTab] = useState<'POSITIONS' | 'ORDERS' | 'HISTORY'>('POSITIONS');

  const mark = ext.market?.marketStats.markPrice ?? '0';
  const effectivePrice = orderType === 'MARKET' ? mark : price || mark;

  const positions = ext.positions;
  const openOrders = ext.openOrders;
  const orderHistory = ext.orderHistory;

  const maxLeverage = useMemo(() => ext.market?.tradingConfig.maxLeverage ?? '1', [ext.market]);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (ext.account.apiKey) ext.connect(ext.account);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-black/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-orange-500 inline-block" />
              <span className="font-mono font-black text-sm tracking-widest text-white uppercase">ORRANGE</span>
            </Link>
            <span className="text-[10px] px-2 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 font-mono font-bold">
              EXTENDED
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border border-amber-500/30 text-amber-300 bg-amber-500/10">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              STARKNET SEPOLIA TESTNET
            </span>
            <a
              href="https://starknet.sepolia.extended.exchange/perp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Extended
            </a>
            <Link
              href="/wallet"
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
            >
              <Wallet className="w-3 h-3" />
              Wallet
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Account / connect bar */}
        <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4">
          {ext.isConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${ext.canTrade ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <div>
                  <div className="text-sm font-bold font-mono">Extended account connected</div>
                  <div className="text-[11px] text-zinc-500 font-mono">
                    {ext.canTrade ? 'Read + trade access' : 'Read-only (missing Stark keys for trading)'}
                  </div>
                </div>
              </div>
              {ext.balance && (
                <div className="flex items-center gap-6 text-right">
                  <Stat label="Equity" value={`$${fmt(ext.balance.equity)}`} accent="text-emerald-400" />
                  <Stat label="Balance" value={`$${fmt(ext.balance.balance)}`} />
                  <Stat label="Available" value={`$${fmt(ext.balance.availableForTrade)}`} />
                  <Stat label="uPnL" value={`$${signed(ext.balance.unrealisedPnl)}`} accent={Number(ext.balance.unrealisedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConnect(true)}
                  className="text-[11px] font-mono px-3 py-1.5 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                >
                  Edit keys
                </button>
                <button
                  onClick={ext.disconnect}
                  className="text-[11px] font-mono px-3 py-1.5 border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-sm font-bold font-mono">Connect your Extended account</div>
                  <div className="text-[11px] text-zinc-500">
                    Paste your API key, Stark keys and vault id from the{' '}
                    <a className="text-orange-400 hover:underline" href="https://starknet.sepolia.extended.exchange/api-management" target="_blank" rel="noopener noreferrer">
                      Extended testnet API-management page
                    </a>
                    . Markets load without an account.
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowConnect(true)}
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors"
              >
                Connect account
              </button>
            </div>
          )}
        </div>

        {/* Market selector */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {ext.markets.map((m) => {
            const active = m.name === ext.selectedMarket;
            const chg = Number(m.marketStats.dailyPriceChangePercentage);
            return (
              <button
                key={m.name}
                onClick={() => ext.setSelectedMarket(m.name)}
                className={`px-3 py-1.5 rounded border text-[11px] font-mono font-bold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-orange-500 border-orange-500 text-black'
                    : 'border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                }`}
              >
                {m.name}
                <span className={`ml-1.5 ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'} ${active ? 'text-black/70' : ''}`}>
                  {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                </span>
              </button>
            );
          })}
          {ext.marketsLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
        </div>

        {ext.marketsError && (
          <div className="border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 rounded-lg flex items-center gap-2">
            <X className="w-4 h-4" />
            {ext.marketsError}
            <button onClick={ext.refreshMarkets} className="ml-auto text-[11px] underline">Retry</button>
          </div>
        )}

        {/* Market stats strip */}
        {ext.market && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <Stat label="Mark Price" value={`$${fmt(mark, 2)}`} accent="text-orange-400" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <Stat label="Index Price" value={`$${fmt(ext.market.marketStats.indexPrice, 2)}`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <Stat label="24h Volume" value={`$${fmt(Number(ext.market.marketStats.dailyVolume) / 1e6, 2)}M`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3 flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <Stat label="Funding (1h)" value={`${(Number(ext.market.marketStats.fundingRate) * 100).toFixed(4)}%`} accent="text-amber-400" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <Stat label="Max Leverage" value={`${maxLeverage}x`} accent="text-purple-300" />
            </div>
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: orderbook + account tabs */}
          <div className="lg:col-span-8 space-y-4">
            {/* Orderbook */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> Order Book — {ext.selectedMarket}
                </h2>
                {ext.orderbook && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    Spread: {fmt(Math.abs(Number(ext.orderbook.ask[0]?.price ?? 0) - Number(ext.orderbook.bid[0]?.price ?? 0)), 2)}
                  </span>
                )}
              </div>
              {!ext.orderbook ? (
                <div className="text-sm text-zinc-600 py-8 text-center font-mono">Loading order book…</div>
              ) : (
                <div className="grid grid-cols-2 gap-4 text-[11px] font-mono">
                  <div>
                    <div className="grid grid-cols-2 text-zinc-500 pb-1 border-b border-zinc-800/60">
                      <span>Bid Qty</span><span className="text-right">Price</span>
                    </div>
                    {ext.orderbook.bid.slice(0, 8).map((l, i) => (
                      <div key={`b${i}`} className="grid grid-cols-2 py-0.5">
                        <span className="text-zinc-400">{fmt(l.qty, 4)}</span>
                        <span className="text-right text-emerald-400">{fmt(l.price, 2)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="grid grid-cols-2 text-zinc-500 pb-1 border-b border-zinc-800/60">
                      <span>Ask Qty</span><span className="text-right">Price</span>
                    </div>
                    {ext.orderbook.ask.slice(0, 8).map((l, i) => (
                      <div key={`a${i}`} className="grid grid-cols-2 py-0.5">
                        <span className="text-zinc-400">{fmt(l.qty, 4)}</span>
                        <span className="text-right text-rose-400">{fmt(l.price, 2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Account tabs */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg">
              <div className="flex items-center gap-1 border-b border-zinc-800/60 px-3 pt-2">
                {(['POSITIONS', 'ORDERS', 'HISTORY'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAccountTab(tab)}
                    className={`px-3 py-2 text-[11px] font-mono font-bold uppercase transition-colors border-b-2 -mb-px ${
                      accountTab === tab ? 'border-orange-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {tab === 'POSITIONS' && `Positions (${positions.length})`}
                    {tab === 'ORDERS' && `Open Orders (${openOrders.length})`}
                    {tab === 'HISTORY' && 'History'}
                  </button>
                ))}
              </div>

              {!ext.isConnected ? (
                <div className="p-8 text-center text-zinc-600 font-mono text-sm">
                  Connect your Extended account to view positions and orders.
                </div>
              ) : accountTab === 'POSITIONS' ? (
                positions.length === 0 ? (
                  <div className="p-8 text-center text-zinc-600 font-mono text-sm">No open positions.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead className="text-zinc-500 uppercase text-[10px]">
                        <tr>
                          <th className="py-2 px-3">Market / Side</th>
                          <th className="py-2 px-3">Size</th>
                          <th className="py-2 px-3">Entry</th>
                          <th className="py-2 px-3">Mark</th>
                          <th className="py-2 px-3">Liq</th>
                          <th className="py-2 px-3">uPnL</th>
                          <th className="py-2 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {positions.map((p: Position) => {
                          const pnl = Number(p.unrealisedPnl);
                          return (
                            <tr key={p.id} className="hover:bg-zinc-900/40">
                              <td className="py-2 px-3">
                                <span className="font-bold text-white">{p.market}</span>{' '}
                                <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${p.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                  {p.side} {fmt(p.leverage, 1)}x
                                </span>
                              </td>
                              <td className="py-2 px-3 text-zinc-300">{fmt(p.size, 4)}</td>
                              <td className="py-2 px-3 text-zinc-300">${fmt(p.openPrice)}</td>
                              <td className="py-2 px-3 text-zinc-300">${fmt(p.markPrice)}</td>
                              <td className="py-2 px-3 text-amber-400">${fmt(p.liquidationPrice)}</td>
                              <td className={`py-2 px-3 font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {signed(p.unrealisedPnl)}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  disabled={!ext.canTrade || ext.submitting}
                                  onClick={() => { void ext.closePosition(p); }}
                                  className="text-[10px] font-mono px-2 py-1 border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                )
              ) : accountTab === 'ORDERS' ? (
                openOrders.length === 0 ? (
                  <div className="p-8 text-center text-zinc-600 font-mono text-sm">No open orders.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] font-mono">
                      <thead className="text-zinc-500 uppercase text-[10px]">
                        <tr>
                          <th className="py-2 px-3">Market</th>
                          <th className="py-2 px-3">Side</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Qty</th>
                          <th className="py-2 px-3">Price</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3 text-right">Cancel</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {openOrders.map((o) => (
                          <tr key={o.id} className="hover:bg-zinc-900/40">
                            <td className="py-2 px-3 text-white">{o.market}</td>
                            <td className={`py-2 px-3 font-bold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{o.side}</td>
                            <td className="py-2 px-3 text-zinc-400">{o.type}</td>
                            <td className="py-2 px-3 text-zinc-300">{fmt(o.qty, 4)}</td>
                            <td className="py-2 px-3 text-zinc-300">{o.price ? `$${fmt(o.price)}` : '—'}</td>
                            <td className="py-2 px-3 text-zinc-400">{o.status}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                disabled={!ext.canTrade}
                                onClick={() => { void ext.cancelOrder(o.id); }}
                                className="text-[10px] font-mono px-2 py-1 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40 transition-colors"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : orderHistory.length === 0 ? (
                <div className="p-8 text-center text-zinc-600 font-mono text-sm">No order history.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead className="text-zinc-500 uppercase text-[10px]">
                      <tr>
                        <th className="py-2 px-3">Market</th>
                        <th className="py-2 px-3">Side</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Qty</th>
                        <th className="py-2 px-3">Avg Price</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {orderHistory.map((o) => (
                        <tr key={o.id} className="hover:bg-zinc-900/40">
                          <td className="py-2 px-3 text-white">{o.market}</td>
                          <td className={`py-2 px-3 font-bold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{o.side}</td>
                          <td className="py-2 px-3 text-zinc-400">{o.type}</td>
                          <td className="py-2 px-3 text-zinc-300">{fmt(o.qty, 4)}</td>
                          <td className="py-2 px-3 text-zinc-300">{o.averagePrice ? `$${fmt(o.averagePrice)}` : '—'}</td>
                          <td className="py-2 px-3 text-zinc-400">{o.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right: order form */}
          <div className="lg:col-span-4">
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-4 sticky top-20">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <ArrowLeftRight className="w-3.5 h-3.5" /> Place Order — {ext.selectedMarket}
              </h2>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSide('BUY')}
                  className={`py-2 rounded text-xs font-bold transition-colors ${side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                >
                  <TrendingUp className="w-4 h-4 inline mr-1" /> Buy / Long
                </button>
                <button
                  onClick={() => setSide('SELL')}
                  className={`py-2 rounded text-xs font-bold transition-colors ${side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                >
                  <TrendingDown className="w-4 h-4 inline mr-1" /> Sell / Short
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOrderType('LIMIT')}
                  className={`py-1.5 rounded text-[11px] font-mono font-bold border transition-colors ${orderType === 'LIMIT' ? 'border-orange-500 text-orange-400 bg-orange-500/10' : 'border-zinc-800 text-zinc-400'}`}
                >
                  Limit
                </button>
                <button
                  onClick={() => setOrderType('MARKET')}
                  className={`py-1.5 rounded text-[11px] font-mono font-bold border transition-colors ${orderType === 'MARKET' ? 'border-orange-500 text-orange-400 bg-orange-500/10' : 'border-zinc-800 text-zinc-400'}`}
                >
                  Market
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Quantity ({ext.market?.assetName ?? 'asset'})</label>
                  <input
                    type="text"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
                    {orderType === 'MARKET' ? 'Price (worst accepted)' : 'Limit Price (USDC)'}
                  </label>
                  <input
                    type="text"
                    value={orderType === 'MARKET' ? mark : price}
                    onChange={(e) => setPrice(e.target.value)}
                    disabled={orderType === 'MARKET'}
                    placeholder={orderType === 'MARKET' ? 'Mark price' : '0.00'}
                    className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400">
                <div className="border border-zinc-800 rounded p-2">
                  <div className="text-[9px] uppercase text-zinc-500">Est. Notional</div>
                  <div className="font-bold text-white">${fmt(Number(effectivePrice || '0') * Number(qty || '0'))}</div>
                </div>
                <div className="border border-zinc-800 rounded p-2">
                  <div className="text-[9px] uppercase text-zinc-500">Max Leverage</div>
                  <div className="font-bold text-purple-300">{maxLeverage}x</div>
                </div>
              </div>

              {ext.actionError && (
                <div className="text-[11px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded p-2 font-mono break-words">
                  {ext.actionError}
                </div>
              )}

              <button
                disabled={!ext.canTrade || ext.submitting || !ext.market}
                onClick={() => {
                  void ext
                    .placeOrder({
                      market: ext.selectedMarket,
                      side,
                      qty,
                      price: effectivePrice,
                      type: orderType,
                      timeInForce: orderType === 'MARKET' ? 'IOC' : 'GTT',
                    })
                    .catch(() => undefined);
                }}
                className={`w-full py-3 rounded text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  side === 'BUY' ? 'bg-emerald-500 hover:bg-emerald-400 text-black' : 'bg-rose-500 hover:bg-rose-400 text-black'
                }`}
              >
                {ext.submitting ? (
                  <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Placing…</span>
                ) : side === 'BUY' ? (
                  'Buy / Long'
                ) : (
                  'Sell / Short'
                )}
              </button>

              {!ext.canTrade && (
                <p className="text-[10px] text-zinc-600 font-mono">
                  Trading requires your Stark L2 key pair + vault id (from Extended&apos;s API-management page).
                </p>
              )}

              {ext.lastPlacedOrder && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Order placed — id {ext.lastPlacedOrder.id}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-[11px] text-zinc-600 font-mono text-center pb-8">
          Extended Exchange is a Starknet perpetuals DEX. This demo integrates Extended normally —
          it is not privacy-native yet. Private collateral / STRK20 bridging is a later phase.
        </p>
      </main>

      {/* Connect modal */}
      {showConnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold font-mono flex items-center gap-2">
                <CircleDollarSign className="w-4 h-4 text-orange-400" /> Extended account
              </h3>
              <button onClick={() => setShowConnect(false)} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <form onSubmit={handleConnect} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">API key</label>
                <input
                  type="text"
                  value={ext.account.apiKey}
                  onChange={(e) => ext.setAccount({ ...ext.account, apiKey: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  placeholder="X-API-KEY"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Stark private key</label>
                <input
                  type="password"
                  value={ext.account.starkPrivateKey}
                  onChange={(e) => ext.setAccount({ ...ext.account, starkPrivateKey: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  placeholder="0x…"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Stark public key</label>
                <input
                  type="text"
                  value={ext.account.starkPublicKey}
                  onChange={(e) => ext.setAccount({ ...ext.account, starkPublicKey: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  placeholder="0x…"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Vault ID (collateral position)</label>
                <input
                  type="text"
                  value={ext.account.vaultId}
                  onChange={(e) => ext.setAccount({ ...ext.account, vaultId: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  placeholder="123"
                />
              </div>

              <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
                Never share your Stark private key. It is only used locally to sign orders and is not
                persisted or uploaded.
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!ext.account.apiKey}
                  className="flex-1 py-2.5 rounded bg-orange-500 hover:bg-orange-400 text-black text-xs font-black uppercase tracking-wider disabled:opacity-40"
                >
                  Connect
                </button>
                <button
                  type="button"
                  onClick={() => setShowConnect(false)}
                  className="px-4 py-2.5 rounded border border-zinc-700 text-zinc-300 text-xs font-mono"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
