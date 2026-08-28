'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Lock,
  Server,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import { useExtended, CANDLE_INTERVALS, type CandleInterval } from '@/hooks/useExtended';
import { useWallet } from '@/context/WalletContext';
import { accountCreationTypedData, accountRegistrationTypedData } from '@/extended/typedData';
import { getExtendedEnvironment } from '@/extended/config';
import { CandleChart } from '@/components/extended/CandleChart';
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

const shortAddress = (addr: string | null | undefined): string => {
  if (!addr) return '—';
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
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
  const { wallet: connectedWallet } = useWallet();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [leverageInput, setLeverageInput] = useState('');
  const [accountTab, setAccountTab] = useState<'POSITIONS' | 'ORDERS' | 'HISTORY' | 'DEPOSITS'>('POSITIONS');
  const [onboardState, setOnboardState] = useState<{ loading: boolean; status?: string; error?: string }>({ loading: false });
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [marketOpen, setMarketOpen] = useState(false);

  const starknetAccount = (connectedWallet?.walletAccount ?? null) as
    | { signMessage(typedData: unknown): Promise<{ r: unknown; s: unknown }>; execute(calls: unknown[]): Promise<{ transaction_hash?: string; transactionHash?: string }> }
    | null;
  const starknetAddress = connectedWallet?.address ?? null;
  const walletOnMainnet = (connectedWallet?.chainId ? String(connectedWallet.chainId).toLowerCase().includes('main') : null) ?? null;

  const mark = ext.market?.marketStats.markPrice ?? '0';
  const effectivePrice = orderType === 'MARKET' ? mark : price || mark;

  // Default qty to the market's minimum order size once markets load.
  useEffect(() => {
    if (!qty && ext.market?.tradingConfig.minOrderSize) setQty(ext.market.tradingConfig.minOrderSize);
  }, [ext.market?.tradingConfig.minOrderSize, qty]);

  // Sync leverage input from the live leverage value.
  useEffect(() => {
    if (ext.leverage && !leverageInput) setLeverageInput(ext.leverage);
  }, [ext.leverage, leverageInput]);

  const handleNativeOnboard = async () => {
    setOnboardState({ loading: true });
    try {
      const account = connectedWallet?.walletAccount;
      const address = connectedWallet?.address;
      if (!account || !address) throw new Error('No Starknet wallet connected.');
      const env = getExtendedEnvironment();
      const time = new Date().toISOString();
      const creationSig = await account.signMessage(accountCreationTypedData(address, env.starknetDomain));
      const registrationSig = await account.signMessage(
        accountRegistrationTypedData(address, env.authHost, time, env.starknetDomain),
      );
      const result = await ext.adapter.onboardStarknet({
        wallet: address,
        accountCreationSig: { r: String(creationSig.r), s: String(creationSig.s) },
        accountRegistrationSig: { r: String(registrationSig.r), s: String(registrationSig.s) },
        time,
      });
      setOnboardState({ loading: false, status: result.status });
      await ext.refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Onboarding failed.';
      // Backend-blocked onboarding (mainnet /auth/register STARKNET → HTTP 500):
      // surface a clean, non-technical message.
      const clean = /HTTP 5\d\d|Failed to fetch|network/i.test(msg)
        ? 'Extended account authorization is temporarily unavailable on mainnet. Try again later, or use provisioned server API credentials.'
        : msg;
      setOnboardState({ loading: false, error: clean });
    }
  };

  const handleDeposit = async () => {
    if (!starknetAccount) return;
    try {
      await ext.depositOnChain(depositAmount, starknetAccount);
      setDepositAmount('');
    } catch {
      // Error is surfaced via depositState.
    }
  };

  const handleWithdraw = async () => {
    try {
      await ext.withdraw(withdrawAmount);
      setWithdrawAmount('');
    } catch {
      // Error surfaced via withdrawState.
    }
  };

  const positions = ext.positions;
  const openOrders = ext.openOrders;
  const orderHistory = ext.orderHistory;
  const maxLeverage = useMemo(() => ext.market?.tradingConfig.maxLeverage ?? '1', [ext.market]);
  const chg = Number(ext.market?.marketStats.dailyPriceChangePercentage ?? 0);
  const depth = ext.orderbook;

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-black/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-orange-500 inline-block" />
              <span className="font-mono font-black text-sm tracking-widest text-white uppercase">ORRANGE</span>
            </Link>
            <span className="text-[10px] px-2 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 font-mono font-bold">
              PERPS
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              STARKNET MAINNET
            </span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://app.extended.exchange/"
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

      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        {/* ── Market selector bar ───────────────────────────────────────────── */}
        <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2 relative">
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {ext.markets.map((m) => {
              const active = m.name === ext.selectedMarket;
              const c = Number(m.marketStats.dailyPriceChangePercentage);
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
                  <span className={`ml-1.5 ${c >= 0 ? 'text-emerald-400' : 'text-rose-400'} ${active ? 'text-black/70' : ''}`}>
                    {c >= 0 ? '+' : ''}{c.toFixed(2)}%
                  </span>
                </button>
              );
            })}
            {ext.marketsLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500 shrink-0" />}
          </div>
          {ext.marketsError && (
            <div className="mt-1 flex items-center gap-2 text-[11px] text-rose-400 font-mono">
              <X className="w-3 h-3" /> {ext.marketsError}
              <button onClick={ext.refreshMarkets} className="underline">Retry</button>
            </div>
          )}
        </div>

        {/* ── Market stats strip ────────────────────────────────────────────── */}
        {ext.market && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-2">
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Mark Price</div>
              <div className={`text-lg font-black font-mono ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${fmt(mark, 2)}
              </div>
              <div className={`text-[11px] font-mono ${chg >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {chg >= 0 ? '+' : ''}{chg.toFixed(2)}% 24h
              </div>
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="Index" value={`$${fmt(ext.market.marketStats.indexPrice, 2)}`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h Volume" value={`$${fmt(Number(ext.market.marketStats.dailyVolume) / 1e6, 2)}M`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="Open Interest" value={`$${fmt(Number(ext.market.marketStats.openInterest) / 1e6, 2)}M`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5 flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <Stat label="Funding (1h)" value={`${(Number(ext.market.marketStats.fundingRate) * 100).toFixed(4)}%`} accent="text-amber-400" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <Stat label="Max Lev" value={`${maxLeverage}x`} accent="text-purple-300" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h Low" value={`$${fmt(ext.market.marketStats.dailyLow, 2)}`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h High" value={`$${fmt(ext.market.marketStats.dailyHigh, 2)}`} />
            </div>
          </div>
        )}

        {/* ── Account / auth banner ─────────────────────────────────────────── */}
        <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4">
          {ext.statusLoading ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
              <span className="text-sm font-mono text-zinc-400">Checking Extended account…</span>
            </div>
          ) : ext.isConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Server className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-sm font-bold font-mono">
                    {ext.status?.session
                      ? `Extended account connected — ${shortAddress(ext.status.session.wallet)}`
                      : 'Extended account connected (server credentials)'}
                  </div>
                  <div className="text-[11px] text-zinc-500 font-mono">
                    {ext.canTrade
                      ? 'Read + trade access — orders and withdrawals are signed server-side'
                      : 'Read-only (server missing Stark keys for trading)'}
                  </div>
                </div>
              </div>
              {ext.balance && (
                <div className="flex items-center gap-6 text-right">
                  <Stat label="Equity" value={`$${fmt(ext.balance.equity)}`} accent="text-emerald-400" />
                  <Stat label="Balance" value={`$${fmt(ext.balance.balance)}`} />
                  <Stat label="Available" value={`$${fmt(ext.balance.availableForTrade)}`} />
                  <Stat label="Margin Ratio" value={`${(Number(ext.balance.marginRatio) * 100).toFixed(2)}%`} />
                  <Stat
                    label="uPnL"
                    value={`$${signed(ext.balance.unrealisedPnl)}`}
                    accent={Number(ext.balance.unrealisedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                  />
                </div>
              )}
              <button
                onClick={ext.refreshStatus}
                className="text-[11px] font-mono px-3 py-1.5 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Lock className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-sm font-bold font-mono">No Extended account connected</div>
                  <div className="text-[11px] text-zinc-500">
                    {starknetAccount
                      ? `A Starknet wallet is connected (${shortAddress(starknetAddress)}). Markets and charts are live; onboard to trade.`
                      : 'Connect a Starknet wallet to onboard, or set the server EXTENDED_* env. Markets, order books and charts are always live.'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {starknetAccount && (
                  <button
                    onClick={() => void handleNativeOnboard()}
                    disabled={onboardState.loading}
                    className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-50"
                  >
                    {onboardState.loading ? (
                      <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing…</span>
                    ) : (
                      'Onboard with wallet'
                    )}
                  </button>
                )}
                {walletOnMainnet === false && (
                  <span className="text-[11px] text-amber-400 font-mono border border-amber-500/30 px-2 py-1 rounded">
                    Switch wallet to Starknet Mainnet
                  </span>
                )}
              </div>
            </div>
          )}
          {ext.statusError && (
            <div className="mt-3 text-[11px] text-rose-400 font-mono">Status error: {ext.statusError}</div>
          )}
          {onboardState.status && (
            <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Onboarded: {onboardState.status} (wallet {shortAddress(starknetAddress)})
            </div>
          )}
          {onboardState.error && (
            <div className="mt-3 text-[11px] text-rose-400 font-mono border border-rose-500/30 bg-rose-500/10 rounded p-2 break-words">
              {onboardState.error}
            </div>
          )}
        </div>

        {/* ── Main grid ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Chart (8 cols) */}
          <div className="xl:col-span-8 space-y-4">
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> {ext.selectedMarket} Chart
                </h2>
                <div className="flex items-center gap-1">
                  {CANDLE_INTERVALS.map((iv: CandleInterval) => (
                    <button
                      key={iv}
                      onClick={() => ext.setCandleInterval(iv)}
                      className={`px-2 py-1 text-[10px] font-mono font-bold rounded border transition-colors ${
                        ext.candleInterval === iv
                          ? 'border-orange-500 text-orange-400 bg-orange-500/10'
                          : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {iv}
                    </button>
                  ))}
                </div>
              </div>
              <CandleChart candles={ext.candles} />
              {ext.candlesLoading && ext.candles.length === 0 && (
                <div className="flex items-center justify-center py-10 text-zinc-600 font-mono text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading candles…
                </div>
              )}
            </div>

            {/* Trades feed */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Market Trades — {ext.selectedMarket}
                </h2>
                {ext.orderbook && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    Spread: {fmt(Math.abs(Number(ext.orderbook.ask[0]?.price ?? 0) - Number(ext.orderbook.bid[0]?.price ?? 0)), 2)}
                  </span>
                )}
              </div>
              <div className="overflow-y-auto max-h-56">
                <table className="w-full text-[11px] font-mono">
                  <thead className="text-zinc-500 uppercase text-[10px] sticky top-0 bg-zinc-950">
                    <tr>
                      <th className="py-1 text-left">Price</th>
                      <th className="py-1 text-right">Size</th>
                      <th className="py-1 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40">
                    {ext.trades.length === 0 ? (
                      <tr><td colSpan={3} className="py-6 text-center text-zinc-600">Waiting for trades…</td></tr>
                    ) : (
                      ext.trades.slice(0, 30).map((t, i) => (
                        <tr key={`${t.i}-${i}`}>
                          <td className={`py-0.5 font-bold ${t.S === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${fmt(t.p, 2)}
                          </td>
                          <td className="py-0.5 text-right text-zinc-300">{fmt(t.q, 4)}</td>
                          <td className="py-0.5 text-right text-zinc-500">{new Date(t.T).toLocaleTimeString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Orderbook + order entry (4 cols) */}
          <div className="xl:col-span-4 space-y-4">
            {/* Orderbook */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2 mb-2">
                <Activity className="w-3.5 h-3.5" /> Order Book — {ext.selectedMarket}
              </h2>
              {!depth ? (
                <div className="text-sm text-zinc-600 py-8 text-center font-mono">Loading order book…</div>
              ) : (
                <div className="text-[11px] font-mono">
                  <div className="grid grid-cols-3 text-zinc-500 pb-1 border-b border-zinc-800/60">
                    <span>Bid</span><span className="text-right">Size</span><span className="text-right">Price</span>
                  </div>
                  {depth.bid.slice(0, 10).map((l, i) => {
                    const bid = Number(l.price);
                    const ask = Number(depth.ask[0]?.price ?? 0);
                    const span = bid / (ask || 1);
                    return (
                      <div key={`b${i}`} className="grid grid-cols-3 py-0.5 relative">
                        <span className="relative z-10 text-emerald-400">{fmt(bid, 2)}</span>
                        <span className="relative z-10 text-right text-zinc-300">{fmt(l.qty, 4)}</span>
                        <span className="relative z-10 text-right text-emerald-400/80">{fmt(Number(l.qty) * bid, 2)}</span>
                      </div>
                    );
                  })}
                  <div className="my-1 py-1 border-y border-zinc-800/80 text-center font-black text-sm">
                    <span className="text-emerald-400">{fmt(depth.bid[0]?.price, 2)}</span>
                    <span className="text-zinc-600 mx-2">/</span>
                    <span className="text-rose-400">{fmt(depth.ask[0]?.price, 2)}</span>
                  </div>
                  {depth.ask.slice(0, 10).map((l, i) => (
                    <div key={`a${i}`} className="grid grid-cols-3 py-0.5">
                      <span className="text-rose-400">{fmt(l.price, 2)}</span>
                      <span className="text-right text-zinc-300">{fmt(l.qty, 4)}</span>
                      <span className="text-right text-rose-400/80">{fmt(Number(l.qty) * Number(l.price), 2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Order entry */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3 sticky top-16">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <ArrowLeftRight className="w-3.5 h-3.5" /> Place Order — {ext.selectedMarket}
              </h2>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSide('BUY')}
                  className={`py-2 rounded text-xs font-bold transition-colors ${side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                >
                  <TrendingUp className="w-4 h-4 inline mr-1" /> Long
                </button>
                <button
                  onClick={() => setSide('SELL')}
                  className={`py-2 rounded text-xs font-bold transition-colors ${side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                >
                  <TrendingDown className="w-4 h-4 inline mr-1" /> Short
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

              {/* Leverage */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Leverage (max {maxLeverage}x)</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={Number(maxLeverage)}
                    step={1}
                    value={leverageInput}
                    onChange={(e) => setLeverageInput(e.target.value)}
                    onBlur={() => {
                      if (leverageInput && leverageInput !== ext.leverage) void ext.setLeverageForMarket(leverageInput);
                    }}
                    className="w-24 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
                  />
                  <span className="text-xs font-mono text-zinc-500">x</span>
                  <button
                    onClick={() => { const v = maxLeverage; setLeverageInput(v); void ext.setLeverageForMarket(v); }}
                    disabled={!ext.canTrade || ext.leverageLoading}
                    className="text-[10px] font-mono px-2 py-1.5 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40"
                  >
                    Max
                  </button>
                  {ext.leverageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Quantity ({ext.market?.assetName ?? 'asset'})</label>
                  <input
                    type="text"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder={ext.market?.tradingConfig.minOrderSize ? `min ${ext.market.tradingConfig.minOrderSize}` : ''}
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
                  <div className="text-[9px] uppercase text-zinc-500">Est. Margin</div>
                  <div className="font-bold text-purple-300">
                    ${fmt(Number(effectivePrice || '0') * Number(qty || '0') / Math.max(1, Number(leverageInput || 1)))}
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                <input
                  type="checkbox"
                  checked={reduceOnly}
                  onChange={(e) => setReduceOnly(e.target.checked)}
                  className="accent-orange-500"
                />
                Reduce-only
              </label>

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
                      reduceOnly: reduceOnly || undefined,
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
                  reduceOnly ? 'Close Short (Reduce)' : 'Buy / Long'
                ) : (
                  reduceOnly ? 'Close Long (Reduce)' : 'Sell / Short'
                )}
              </button>

              {!ext.canTrade && (
                <p className="text-[10px] text-zinc-600 font-mono">
                  Trading requires an onboarded wallet or server EXTENDED_* credentials. Orders are signed server-side.
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

        {/* ── Account tabs: positions / orders / history / deposits ─────────── */}
        <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg">
          <div className="flex items-center gap-1 border-b border-zinc-800/60 px-3 pt-2 overflow-x-auto">
            {([
              ['POSITIONS', `Positions (${positions.length})`],
              ['ORDERS', `Open Orders (${openOrders.length})`],
              ['HISTORY', 'History'],
              ['DEPOSITS', 'Deposits'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setAccountTab(tab)}
                className={`px-3 py-2 text-[11px] font-mono font-bold uppercase transition-colors border-b-2 -mb-px whitespace-nowrap ${
                  accountTab === tab ? 'border-orange-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!ext.isConnected ? (
            <div className="p-8 text-center text-zinc-600 font-mono text-sm">
              Connect an Extended account (onboard a wallet or configure server credentials) to view account data.
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
                      <th className="py-2 px-3">Liq. Price</th>
                      <th className="py-2 px-3">Margin</th>
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
                          <td className="py-2 px-3 text-zinc-400">${fmt(p.margin)}</td>
                          <td className={`py-2 px-3 font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${signed(p.unrealisedPnl)}
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
          ) : accountTab === 'DEPOSITS' ? (
            <div className="p-4 space-y-3">
              {ext.deposits.length === 0 ? (
                <div className="p-4 text-center text-zinc-600 font-mono text-sm">No deposits yet.</div>
              ) : (
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="text-zinc-500 uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Amount</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {ext.deposits.slice(0, 20).map((d, i) => (
                      <tr key={d.id ?? i}>
                        <td className="py-2 px-3 text-zinc-200">${fmt(d.amount)}</td>
                        <td className="py-2 px-3 text-zinc-400">{d.status}</td>
                        <td className="py-2 px-3 text-zinc-500">{d.timestamp ? new Date(d.timestamp).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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

        {/* ── Deposit / Withdraw panel ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit USDC (native Starknet)
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              Approve + deposit to the Extended core contract (vault {ext.accountInfo?.l2Vault ?? '—'}). Requires a mainnet Starknet wallet.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.00 USDC"
                className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
              />
              <button
                onClick={() => void handleDeposit()}
                disabled={!starknetAccount || !ext.accountInfo || ext.depositState.status === 'signing' || ext.depositState.status === 'submitted'}
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-40"
              >
                {ext.depositState.status === 'signing' || ext.depositState.status === 'submitted' ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Depositing…</span>
                ) : 'Deposit'}
              </button>
            </div>
            {!starknetAccount && (
              <p className="text-[10px] text-zinc-600 font-mono">Connect a Starknet wallet to deposit. The wallet must be on Starknet Mainnet.</p>
            )}
            {ext.depositState.status === 'submitted' && ext.depositState.transactionHash && (
              <a
                href={`${ext.env.explorerUrl}/tx/${ext.depositState.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] font-mono text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded p-2"
              >
                <ExternalLink className="w-3 h-3" /> Deposit submitted — {shortAddress(ext.depositState.transactionHash)}
              </a>
            )}
            {ext.depositState.status === 'confirmed' && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Deposit confirmed. Balance refreshes on the next poll.
              </div>
            )}
            {ext.depositState.status === 'error' && (
              <div className="text-[11px] text-rose-400 font-mono border border-rose-500/30 bg-rose-500/10 rounded p-2 break-words">
                {ext.depositState.error}
              </div>
            )}
          </div>

          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw USDC
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              Starknet withdrawal, signed server-side. Max: ${fmt(ext.balance?.availableForWithdrawal ?? '0')} available.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00 USDC"
                className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
              />
              <button
                onClick={() => void handleWithdraw()}
                disabled={!ext.canTrade || ext.withdrawState.loading}
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-40"
              >
                {ext.withdrawState.loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Withdrawing…</span>
                ) : 'Withdraw'}
              </button>
            </div>
            {ext.withdrawState.id && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded p-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Withdrawal created — id {ext.withdrawState.id}
              </div>
            )}
            {ext.withdrawState.error && (
              <div className="text-[11px] text-rose-400 font-mono border border-rose-500/30 bg-rose-500/10 rounded p-2 break-words">
                {ext.withdrawState.error}
              </div>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-[11px] text-zinc-600 font-mono text-center pb-8">
          Extended Exchange perps terminal on Starknet Mainnet. Public market data is live; private trading is signed
          server-side. Native Starknet wallet onboarding depends on Extended's mainnet auth service.
        </p>
      </main>
    </div>
  );
}