'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react';
import { ExtendedWalletProvider, useExtendedWallet } from '@/context/ExtendedWalletContext';
import { useExtended, CANDLE_INTERVALS, type CandleInterval } from '@/hooks/useExtended';
import { CandleChart } from '@/components/extended/CandleChart';
import { OrderBook } from '@/components/extended/OrderBook';
import { OrderPanel, type OrderSide } from '@/components/extended/OrderPanel';
import type { Position } from '@/extended/types';
import { translateError } from '@/hooks/useExtended';

const MARKET_PERSIST_KEY = 'orrange_extended_selected_market';

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

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border ${ok ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-amber-500/30 text-amber-300 bg-amber-500/10'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
      {label}
    </span>
  );
}

/** The Extended terminal content. Wrapped by ExtendedWalletProvider below. */
function ExtendedTerminal() {
  const { wallet, connect, disconnect, requestMainnetSwitch } = useExtendedWallet();
  const ext = useExtended({
    address: wallet.address,
    chainId: wallet.chainId,
    isConnected: wallet.isConnected,
    walletAccount: wallet.walletAccount,
  });

  // Market selection persisted locally (scoped to the Extended terminal).
  const [marketSearch, setMarketSearch] = useState('');
  const [showMarketList, setShowMarketList] = useState(false);
  const [accountTab, setAccountTab] = useState<'POSITIONS' | 'ORDERS' | 'HISTORY' | 'DEPOSITS'>('POSITIONS');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [orderBookPrice, setOrderBookPrice] = useState<{ price: string; side: OrderSide } | null>(null);

  const persistSelectedMarket = useCallback((name: string) => {
    try {
      localStorage.setItem(MARKET_PERSIST_KEY, name);
    } catch {
      // Ignore storage errors.
    }
    ext.setSelectedMarket(name);
  }, [ext]);

  // Restore the persisted market once markets load.
  useEffect(() => {
    if (ext.markets.length === 0) return;
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(MARKET_PERSIST_KEY) : null;
    if (saved && ext.markets.some((m) => m.name === saved) && saved !== ext.selectedMarket) {
      ext.setSelectedMarket(saved);
    }
  }, [ext.markets]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMarkets = useMemo(() => {
    const q = marketSearch.trim().toLowerCase();
    if (!q) return ext.markets;
    return ext.markets.filter((m) => m.name.toLowerCase().includes(q) || m.assetName.toLowerCase().includes(q));
  }, [ext.markets, marketSearch]);

  const market = ext.market;
  const chg = Number(market?.marketStats.dailyPriceChangePercentage ?? 0);
  const maxLeverage = market?.tradingConfig.maxLeverage ?? '1';
  const fundingRate = Number(market?.marketStats.fundingRate ?? 0) * 100;

  const starknetAccount = wallet.walletAccount;
  const starknetAddress = wallet.address;
  const walletConnected = wallet.isConnected && Boolean(starknetAddress);
  const onMainnet = wallet.onMainnet;

  const terminalActive = ext.sessionState === 'active';
  const canTrade = ext.canTrade && onMainnet === true;

  // Order book price selection → order panel.
  const handleOrderBookPrice = useCallback((price: string, side: OrderSide) => {
    setOrderBookPrice({ price, side });
  }, []);

  const handleDeposit = async () => {
    if (!starknetAccount) return;
    try {
      await ext.depositOnChain(depositAmount, starknetAccount);
      setDepositAmount('');
    } catch {
      // Error surfaced via depositState.
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

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-black/90 backdrop-blur-md">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-orange-500 inline-block" />
              <span className="font-mono font-black text-sm tracking-widest text-white uppercase">ORRANGE</span>
            </Link>
            <span className="text-[10px] px-2 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 font-mono font-bold">
              EXTENDED
            </span>
            <StatusPill ok={onMainnet !== false} label={onMainnet === false ? 'SWITCH TO MAINNET' : 'STARKNET MAINNET'} />
          </div>

          <div className="flex items-center gap-2">
            {walletConnected ? (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Ready · {shortAddress(starknetAddress)}
              </span>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 border border-zinc-800 text-zinc-500">
                Ready not connected
              </span>
            )}
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
              Privacy Wallet
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        {/* ── Connection gate ───────────────────────────────────────────── */}
        {!wallet.isDetected ? (
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-8 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
              <Plug className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-mono text-white">Install Ready Wallet</h2>
              <p className="text-sm text-zinc-400 font-mono mt-1 max-w-md">
                Extended requires a Starknet wallet in your browser. Ready (formerly Argent X)
                is the recommended wallet for Starknet Mainnet.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <a
                href="https://chromewebstore.google.com/detail/ready-wallet-formerly-arg/dlcobpjiigpikoobohmabehhmhfoodbb"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors"
              >
                Install Ready Wallet
              </a>
              <a
                href="https://ready.co/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono px-4 py-2 border border-zinc-700 text-zinc-300 hover:text-white transition-colors"
              >
                ready.co
              </a>
            </div>
            <p className="text-[11px] text-zinc-600 font-mono">
              Other Starknet wallets (Argent X, Braavos) may work once connected — markets load below regardless.
            </p>
          </div>
        ) : !walletConnected ? (
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-8 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-mono text-white">Connect Ready Wallet</h2>
              <p className="text-sm text-zinc-400 font-mono mt-1 max-w-md">
                This connects your Ready Starknet wallet to the Extended perps terminal on
                Starknet Mainnet. It is completely separate from your Orrange privacy wallet.
              </p>
            </div>
            {wallet.error && (
              <div className="flex items-center gap-2 text-[12px] text-amber-300 font-mono border border-amber-500/30 bg-amber-500/10 rounded px-3 py-2">
                <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                {wallet.error}
              </div>
            )}
            <button
              onClick={() => void connect()}
              disabled={wallet.isConnecting}
              className="inline-flex items-center gap-2 text-[12px] font-mono font-bold px-5 py-2.5 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-50"
            >
              {wallet.isConnecting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
              ) : (
                <><Wallet className="w-4 h-4" /> Connect Ready Wallet</>
              )}
            </button>
            <p className="text-[10px] text-zinc-600 font-mono">
              Markets, charts and the order book are live and visible below even before you connect.
            </p>
          </div>
        ) : onMainnet === false ? (
          <div className="border border-rose-500/40 bg-rose-500/10 rounded-lg p-8 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
              <TriangleAlert className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-mono text-white">Wrong Network</h2>
              <p className="text-sm text-zinc-400 font-mono mt-1 max-w-md">
                Your Ready wallet is currently on a network other than Starknet Mainnet.
                Extended only runs on <span className="text-white">Starknet Mainnet</span>.
                Orrange never signs or transacts on the wrong network.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => void requestMainnetSwitch()}
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors"
              >
                Switch to Starknet Mainnet
              </button>
              <button
                onClick={disconnect}
                className="text-[11px] font-mono px-4 py-2 border border-zinc-700 text-zinc-300 hover:text-white transition-colors"
              >
                Disconnect wallet
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 font-mono">
              Current chain: {wallet.chainId ?? 'unknown'}. Switch inside your wallet if the button doesn't work.
            </p>
          </div>
        ) : (
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-6">
            {terminalActive ? (
              <AccountConnectedBar
                ext={ext}
                walletAddress={starknetAddress}
                onDisconnect={disconnect}
              />
            ) : (
              <OnboardingFlow ext={ext} walletAddress={starknetAddress} />
            )}
          </div>
        )}

        {/* ── Market selector bar ───────────────────────────────────────── */}
        <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2 relative">
          <div className="flex items-center gap-2">
            <div className="relative shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                value={marketSearch}
                onChange={(e) => { setMarketSearch(e.target.value); setShowMarketList(true); }}
                onFocus={() => setShowMarketList(true)}
                onBlur={() => setTimeout(() => setShowMarketList(false), 150)}
                placeholder="Search markets…"
                className="w-40 px-7 py-1.5 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-[11px] font-mono outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {ext.markets.map((m) => {
                const active = m.name === ext.selectedMarket;
                const c = Number(m.marketStats.dailyPriceChangePercentage);
                return (
                  <button
                    key={m.name}
                    onClick={() => persistSelectedMarket(m.name)}
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
          </div>

          {showMarketList && filteredMarkets.length > 0 && (
            <div className="absolute left-2 right-2 top-full mt-1 z-30 border border-zinc-800 bg-zinc-950 rounded-lg shadow-2xl max-h-72 overflow-y-auto">
              {filteredMarkets.map((m) => {
                const active = m.name === ext.selectedMarket;
                const c = Number(m.marketStats.dailyPriceChangePercentage);
                return (
                  <button
                    key={m.name}
                    onClick={() => { persistSelectedMarket(m.name); setShowMarketList(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-mono hover:bg-zinc-900 transition-colors ${active ? 'bg-zinc-900' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-white">{m.name}</span>
                      <span className={`text-[9px] px-1 py-0.5 rounded ${m.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                        {m.status}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={`font-bold ${c >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${fmt(m.marketStats.lastPrice, m.assetPrecision > 2 ? 4 : 2)}
                      </span>
                      <span className="text-zinc-500 w-20 text-right">{c >= 0 ? '+' : ''}{c.toFixed(2)}%</span>
                      <span className="text-zinc-600 w-24 text-right">${fmt(Number(m.marketStats.dailyVolume) / 1e6, 1)}M</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {ext.marketsError && (
            <div className="mt-1 flex items-center gap-2 text-[11px] text-rose-400 font-mono">
              <X className="w-3 h-3" /> {translateError(ext.marketsError)}
              <button onClick={ext.refreshMarkets} className="underline">Retry</button>
            </div>
          )}
        </div>

        {/* ── Market stats strip ────────────────────────────────────────── */}
        {market && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Mark Price</div>
              <div className={`text-lg font-black font-mono ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${fmt(market.marketStats.markPrice, market.assetPrecision > 2 ? 4 : 2)}
              </div>
              <div className={`text-[11px] font-mono ${chg >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {chg >= 0 ? '+' : ''}{chg.toFixed(2)}% 24h
              </div>
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="Last" value={`$${fmt(market.marketStats.lastPrice, market.assetPrecision > 2 ? 4 : 2)}`} />
              <div className="text-[10px] font-mono text-zinc-600 mt-1">Index ${fmt(market.marketStats.indexPrice, 2)}</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h Volume" value={`$${fmt(Number(market.marketStats.dailyVolume) / 1e6, 2)}M`} />
              <div className="text-[10px] font-mono text-zinc-600 mt-1">OI ${fmt(Number(market.marketStats.openInterest) / 1e6, 2)}M</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5 flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              <Stat label="Funding (1h)" value={`${fundingRate.toFixed(4)}%`} accent="text-amber-400" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <Stat label="Max Lev" value={`${maxLeverage}x`} accent="text-purple-300" />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h Low" value={`$${fmt(market.marketStats.dailyLow, 2)}`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="24h High" value={`$${fmt(market.marketStats.dailyHigh, 2)}`} />
            </div>
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-2.5">
              <Stat label="Status" value={market.status} accent={market.status === 'ACTIVE' ? 'text-emerald-400' : 'text-amber-400'} />
            </div>
          </div>
        )}

        {/* ── Main grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 space-y-4">
            {/* Chart */}
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
              {!ext.candlesLoading && ext.candles.length === 0 && !ext.marketsLoading && (
                <div className="py-10 text-center text-zinc-600 font-mono text-sm">
                  No candle data for {ext.selectedMarket}.
                </div>
              )}
            </div>

            {/* Trades feed */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> Market Trades — {ext.selectedMarket}
                </h2>
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

          <div className="xl:col-span-4 space-y-4">
            {/* Order book */}
            <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> Order Book — {ext.selectedMarket}
                </h2>
                <button onClick={() => void ext.refreshOrderbook?.()} title="Refresh order book" className="text-zinc-600 hover:text-zinc-300">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <OrderBook
                book={ext.orderbook}
                onSelectPrice={handleOrderBookPrice}
              />
            </div>

            {/* Order entry */}
            <OrderPanel
              market={market}
              balance={ext.balance}
              canTrade={canTrade}
              leverage={ext.leverage}
              leverageLoading={ext.leverageLoading}
              setLeverageForMarket={ext.setLeverageForMarket}
              submitting={ext.submitting}
              lastOrder={ext.lastOrder}
              lastOrderStatus={ext.lastOrderStatus}
              trackingOrder={ext.trackingOrder}
              actionError={ext.actionError}
              clearActionError={ext.clearActionError}
              placeOrder={ext.placeOrder}
              orderBookPrice={orderBookPrice}
              setOrderBookPrice={setOrderBookPrice}
            />
          </div>
        </div>

        {/* ── Account tabs ──────────────────────────────────────────────── */}
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
              {walletConnected
                ? 'Complete Extended onboarding above to view your account.'
                : 'Connect your Ready wallet and onboard to view your account.'}
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
                      <th className="py-2 px-3">ROE</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {positions.map((p: Position) => {
                      const pnl = Number(p.unrealisedPnl);
                      const margin = Number(p.margin) || 1;
                      const roe = (pnl / margin) * 100;
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
                          <td className={`py-2 px-3 font-bold ${roe >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {roe >= 0 ? '+' : ''}{fmt(roe.toFixed(2), 2)}%
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              disabled={!canTrade || ext.submitting}
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
                      <th className="py-2 px-3">Order ID</th>
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
                        <td className="py-2 px-3 text-zinc-500">#{o.id}</td>
                        <td className="py-2 px-3 text-white">{o.market}</td>
                        <td className={`py-2 px-3 font-bold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{o.side}</td>
                        <td className="py-2 px-3 text-zinc-400">{o.type}</td>
                        <td className="py-2 px-3 text-zinc-300">{fmt(o.qty, 4)}</td>
                        <td className="py-2 px-3 text-zinc-300">{o.price ? `$${fmt(o.price)}` : '—'}</td>
                        <td className="py-2 px-3 text-amber-300">{o.status}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            disabled={!canTrade}
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
            <div className="p-4">
              {ext.deposits.length === 0 ? (
                <div className="p-4 text-center text-zinc-600 font-mono text-sm">No deposits yet.</div>
              ) : (
                <table className="w-full text-left text-[11px] font-mono">
                  <thead className="text-zinc-500 uppercase text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Amount</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {ext.deposits.slice(0, 20).map((d, i) => (
                      <tr key={d.id ?? i}>
                        <td className="py-2 px-3 text-zinc-200">${fmt(d.amount)}</td>
                        <td className="py-2 px-3 text-zinc-400">{d.status}</td>
                        <td className="py-2 px-3 text-zinc-500">{d.timestamp ? new Date(d.timestamp).toLocaleString() : '—'}</td>
                        <td className="py-2 px-3 text-zinc-500">
                          {d.transactionHash ? (
                            <a
                              href={`${ext.env.explorerUrl}/tx/${d.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-400 hover:text-white"
                            >
                              {shortAddress(d.transactionHash)}
                            </a>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : ext.orderHistory.length === 0 ? (
            <div className="p-8 text-center text-zinc-600 font-mono text-sm">No order history.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] font-mono">
                <thead className="text-zinc-500 uppercase text-[10px]">
                  <tr>
                    <th className="py-2 px-3">Order ID</th>
                    <th className="py-2 px-3">Market</th>
                    <th className="py-2 px-3">Side</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Qty</th>
                    <th className="py-2 px-3">Avg Price</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {ext.orderHistory.map((o) => (
                    <tr key={o.id} className="hover:bg-zinc-900/40">
                      <td className="py-2 px-3 text-zinc-500">#{o.id}</td>
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

        {/* ── Deposit / Withdraw panel ──────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit USDC (native Starknet)
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              Approve + deposit to the Extended core contract (vault {ext.accountInfo?.l2Vault ?? '—'}). Requires your Ready wallet on Starknet Mainnet.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0.00 USDC"
                className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
              />
              <button
                onClick={() => void handleDeposit()}
                disabled={!starknetAccount || !ext.accountInfo || !canTrade || ext.depositState.status === 'signing' || ext.depositState.status === 'submitted'}
                className="text-[11px] font-mono font-bold px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-40"
              >
                {ext.depositState.status === 'signing' || ext.depositState.status === 'submitted' ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Depositing…</span>
                ) : 'Deposit'}
              </button>
            </div>
            {!starknetAccount && (
              <p className="text-[10px] text-zinc-600 font-mono">Connect your Ready wallet on Starknet Mainnet to deposit.</p>
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
                <CheckCircle2 className="w-3.5 h-3.5" /> Deposit confirmed. Balance reconciles automatically.
              </div>
            )}
            {ext.depositState.status === 'error' && (
              <div className="text-[11px] text-rose-400 font-mono border border-rose-500/30 bg-rose-500/10 rounded p-2 break-words">
                {translateError(ext.depositState.error)}
              </div>
            )}
          </div>

          <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw USDC
            </h2>
            <p className="text-[11px] text-zinc-500 font-mono">
              Starknet withdrawal, signed server-side, returned to <span className="text-zinc-300">{shortAddress(starknetAddress)}</span>.
              Max: ${fmt(ext.balance?.availableForWithdrawal ?? '0')} available.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00 USDC"
                className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
              />
              <button
                onClick={() => void handleWithdraw()}
                disabled={!canTrade || ext.withdrawState.loading}
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
                {translateError(ext.withdrawState.error)}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-[11px] text-zinc-600 font-mono text-center pb-8">
          Extended Exchange perps terminal on Starknet Mainnet. Your Extended trading balance is held by Extended
          Exchange and is separate from your Orrange STRK20 private balance. Orders and withdrawals are signed
          server-side; no private keys or API credentials are exposed in the browser.
        </p>
      </main>
    </div>
  );
}

/** Active-account connection bar with clear Orrange-vs-Extended balance split. */
function AccountConnectedBar({
  ext,
  walletAddress,
  onDisconnect,
}: {
  ext: ReturnType<typeof useExtended>;
  walletAddress: string | null;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Server className="w-4 h-4 text-emerald-400" />
          <div>
            <div className="text-sm font-bold font-mono">
              Extended account connected — {shortAddress(ext.status?.session?.wallet ?? walletAddress)}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              {ext.canTrade
                ? `Read + trade · Account #${ext.accountInfo?.accountId ?? '—'} · Vault #${ext.accountInfo?.l2Vault ?? '—'} · orders signed server-side`
                : 'Read-only access'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={ext.refreshStatus}
            className="text-[11px] font-mono px-3 py-1.5 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={onDisconnect}
            className="text-[11px] font-mono px-3 py-1.5 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {ext.accountError && (
        <div className="text-[11px] text-rose-400 font-mono">{translateError(ext.accountError)}</div>
      )}

      {/* Clear split between the two wallet domains. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border border-orange-500/20 bg-orange-500/5 rounded-lg p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-orange-400 font-mono font-bold">
            <Wallet className="w-3.5 h-3.5" /> Orrange Privacy Wallet
          </div>
          <div className="text-[11px] text-zinc-500 font-mono mt-1 leading-relaxed">
            STRK20 private balances, shielding and unshielding — managed in the Privacy Wallet, untouched here.
          </div>
        </div>
        <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-emerald-400 font-mono font-bold">
            <Activity className="w-3.5 h-3.5" /> Extended Trading Balance
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-right">
            <Stat label="Equity" value={`$${fmt(ext.balance?.equity)}`} accent="text-emerald-400" />
            <Stat label="Balance" value={`$${fmt(ext.balance?.balance)}`} />
            <Stat label="Available" value={`$${fmt(ext.balance?.availableForTrade)}`} />
            <Stat label="uPnL" value={`$${signed(ext.balance?.unrealisedPnl)}`} accent={Number(ext.balance?.unrealisedPnl) >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
          </div>
          <div className="text-[10px] text-zinc-600 font-mono mt-1 leading-relaxed">
            Collateral held by Extended Exchange for trading only — it is not private and is separate from your Orrange STRK20 balance.
          </div>
        </div>
      </div>
    </div>
  );
}

const ONBOARDING_STEPS: { key: string; label: string }[] = [
  { key: 'checking', label: 'CONNECTING' },
  { key: 'signing', label: 'SIGN ACCOUNT CREATION' },
  { key: 'signing', label: 'SIGN ACCOUNT REGISTRATION' },
  { key: 'submitting', label: 'CREATING EXTENDED ACCOUNT' },
];

/** Native Starknet Extended onboarding state machine (no EVM fallback). */
function OnboardingFlow({
  ext,
  walletAddress,
}: {
  ext: ReturnType<typeof useExtended>;
  walletAddress: string | null;
}) {
  const state = ext.onboardingState;
  const activeStep =
    state === 'checking' ? 0
    : state === 'signing' ? 1
    : state === 'submitting' ? 3
    : null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex items-start gap-3 max-w-xl">
        <Lock className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-bold font-mono text-white">Enable Extended Perps</div>
          <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
            Create your Extended perps account natively with your Ready Starknet wallet{' '}
            <span className="text-zinc-300 font-mono">{shortAddress(walletAddress)}</span>.
            Two SNIP-12 signature requests will appear in your wallet. Your L2 key is derived and stored server-side.
          </div>
        </div>
      </div>

      <div className="min-w-[260px] space-y-3">
        {/* Onboarding status panel */}
        <div className={`border rounded-lg p-3 ${
          state === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10'
            : state === 'unavailable' || state === 'error' || state === 'notDeployed' || state === 'checkFailed'
              ? 'border-amber-500/30 bg-amber-500/10'
              : state === 'checking' || state === 'signing' || state === 'submitting'
                ? 'border-orange-500/30 bg-orange-500/10'
                : 'border-zinc-800 bg-zinc-900/40'
        }`}>
          <div className="flex items-center gap-2">
            {state === 'checking' || state === 'signing' || state === 'submitting' ? (
              <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
            ) : state === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : state === 'unavailable' || state === 'error' || state === 'notDeployed' || state === 'checkFailed' ? (
              <TriangleAlert className="w-4 h-4 text-amber-400" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-orange-400" />
            )}
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-200">
              {state === 'checking' && 'Connecting'}
              {state === 'signing' && 'Signing requests'}
              {state === 'submitting' && 'Creating account'}
              {state === 'success' && 'Extended account ready'}
              {state === 'notDeployed' && 'Wallet not deployed on Mainnet'}
              {state === 'checkFailed' && 'Could not verify wallet'}
              {(state === 'unavailable' || state === 'error') && 'Extended unavailable right now'}
              {state === 'idle' && 'Connect to Extended'}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">
            {state === 'checking' && 'Checking that your wallet is deployed on Starknet Mainnet…'}
            {state === 'signing' && 'Approve the Account Creation and Account Registration signatures in your wallet.'}
            {state === 'submitting' && 'Registering your Extended account and setting up your vault…'}
            {state === 'success' && 'Loading your account into the terminal…'}
            {state === 'notDeployed' && 'Your wallet must be deployed on Starknet Mainnet before it can trade. Fund it once to deploy it, then come back.'}
            {state === 'checkFailed' && 'We could not confirm the wallet on Starknet Mainnet right now. Check your connection and try again.'}
            {state === 'idle' && 'Create your Extended perps account with the connected Starknet wallet.'}
            {state === 'unavailable' && ext.onboardingDetail}
            {state === 'error' && ext.onboardingDetail}
          </p>

          {/* Step indicator */}
          {activeStep !== null && (
            <div className="mt-2 space-y-1">
              {ONBOARDING_STEPS.map((s, i) => {
                const done = i < activeStep;
                const current = i === activeStep && s.key === 'signing';
                return (
                  <div key={`${s.label}-${i}`} className="flex items-center gap-2 text-[10px] font-mono">
                    {done ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : current ? (
                      <Loader2 className="w-3 h-3 animate-spin text-orange-400" />
                    ) : i <= activeStep ? (
                      <Clock className="w-3 h-3 text-orange-400" />
                    ) : (
                      <span className="w-3 h-3 inline-block border border-zinc-700 rounded-full" />
                    )}
                    <span className={done || i <= activeStep ? 'text-zinc-300' : 'text-zinc-600'}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => void ext.runOnboarding()}
          disabled={state === 'checking' || state === 'signing' || state === 'submitting' || state === 'success'}
          className="w-full inline-flex items-center justify-center gap-2 text-[11px] font-mono font-bold px-4 py-2.5 bg-orange-500 hover:bg-orange-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === 'checking' || state === 'signing' || state === 'submitting' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…</>
          ) : state === 'notDeployed' || state === 'checkFailed' ? (
            'Re-check wallet'
          ) : state === 'success' ? (
            'Account ready'
          ) : (
            'Connect to Extended'
          )}
        </button>

        <p className="text-[10px] text-zinc-600 font-mono leading-relaxed">
          The whole flow runs natively on Starknet Mainnet with your Ready wallet. No EVM account is created.
        </p>
      </div>
    </div>
  );
}

export default function ExtendedPage() {
  return (
    <ExtendedWalletProvider>
      <ExtendedTerminal />
    </ExtendedWalletProvider>
  );
}