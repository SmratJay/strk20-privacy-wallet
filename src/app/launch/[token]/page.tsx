'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  Shield,
  Globe,
  CheckCircle2,
  X,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import { getLaunchNetwork, LaunchTokenEntry, isTokenLive } from '@/config/launch';
import {
  loadTokenSnapshot,
  TokenSnapshot,
  quoteBuy,
  quoteSell,
  executePublicBuy,
  executePublicSell,
  getTokenBalance,
  baseUsdFor,
} from '@/services/launchService';
import {
  buildPrivateBuyActions,
  buildPrivateSellActions,
  executePrivateTrade,
  CURVE_OP,
} from '@/services/privateLaunchService';
import { strk20WalletApiService } from '@/services/strk20WalletApiService';
import { formatTokenAmount, parseTokenAmount, shortenAddress } from '@/utils/formatters';

type Side = 'BUY' | 'SELL';
type Mode = 'PUBLIC' | 'PRIVATE';
type Step = 'QUOTING' | 'SIGNING' | 'PROVING' | 'SUBMITTING' | 'DONE';

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v === 0) return '—';
  return `$${v.toFixed(2)}`;
}

function fmtPriceUsd(v: number): string {
  if (v === 0) return '—';
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(2)}`;
}

export default function LaunchTokenPage() {
  const params = useParams<{ token: string }>();
  const id = params?.token ?? '';
  const { wallet, networkId, balances, refreshAfterMutation } = useWallet();

  const net = getLaunchNetwork(networkId);
  const [entry, setEntry] = useState<LaunchTokenEntry | null>(null);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const [side, setSide] = useState<Side>('BUY');
  const [mode, setMode] = useState<Mode>('PUBLIC');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ output: string; outputSymbol: string; gasEstimate: string | null } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicTokenBalance, setPublicTokenBalance] = useState<bigint | null>(null);
  const [privateTokenBalance, setPrivateTokenBalance] = useState<bigint | null>(null);
  const [privateBalanceStatus, setPrivateBalanceStatus] = useState<'UNKNOWN' | 'OK' | 'ERR'>('UNKNOWN');

  const base = net.baseAsset;
  const baseSymbol = 'STRK';
  const baseDecimals = net.baseAssetDecimals;

  // Public/private base balances from the wallet context (STRK is a configured token).
  const strkBalanceRow = useMemo(
    () => balances.find((b) => b.token.address.toLowerCase() === base.toLowerCase()),
    [balances, base],
  );
  const publicStrk = strkBalanceRow?.publicBalance ?? 0n;
  const privateStrk = strkBalanceRow?.shieldedBalance ?? 0n;
  const privateStrkAvailable = strkBalanceRow?.shieldedBalanceAvailable === true;

  const live = entry ? isTokenLive(entry) : false;
  const decimals = snapshot?.metadata?.decimals ?? 18;
  const tokenSymbol = snapshot?.metadata?.symbol ?? entry?.symbol ?? 'TOKEN';

  // Resolve entry from the registry / factory on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { listTokens } = await import('@/services/launchService');
        const list = await listTokens(networkId);
        const found = list.find((e) => e.id === id || e.symbol.toLowerCase() === id.toLowerCase());
        if (cancelled) return;
        if (!found) {
          setError(`No memecoin found for "${id}".`);
          setEntry(null);
          return;
        }
        setEntry(found);
        const snap = await loadTokenSnapshot(networkId, found);
        if (!cancelled) setSnapshot(snap);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load this token.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, networkId]);

  // Refresh token balances after connection / mutation.
  const refreshBalances = useCallback(async () => {
    if (!wallet.address || !entry) return;
    if (isTokenLive(entry)) {
      const pub = await getTokenBalance(networkId, entry.token, wallet.address);
      if (pub !== null) setPublicTokenBalance(pub);
    }
  }, [wallet.address, entry, networkId]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances, snapshot?.curve?.priceBase]);

  // Private token balance via the STRK20 wallet lane (best-effort).
  const refreshPrivateTokenBalance = useCallback(async () => {
    if (!entry) return;
    try {
      const entries = await strk20WalletApiService.getPrivateBalances(wallet, [entry.token]);
      const row = entries.find((e) => e.token.toLowerCase() === entry.token.toLowerCase());
      setPrivateTokenBalance(row?.balance ?? 0n);
      setPrivateBalanceStatus('OK');
    } catch {
      setPrivateBalanceStatus('ERR');
    }
  }, [entry, wallet]);

  const connected = wallet.isConnected;
  const privateCapable = connected && !!(wallet.walletAccount || wallet.rawWallet);

  const refreshQuote = useCallback(async () => {
    if (!entry || !live || !amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const parsed = parseTokenAmount(amount, side === 'BUY' ? baseDecimals : decimals);
      let output: bigint | null = null;
      if (side === 'BUY') output = await quoteBuy(networkId, entry.curve, parsed);
      else output = await quoteSell(networkId, entry.curve, parsed);
      if (output === null) {
        setQuoteError('Could not fetch an on-chain quote for this amount.');
        return;
      }
      setQuote({
        output: formatTokenAmount(output, side === 'BUY' ? decimals : baseDecimals, decimals >= 8 ? 6 : 4),
        outputSymbol: side === 'BUY' ? tokenSymbol : baseSymbol,
        gasEstimate: null,
      });
    } catch (e: any) {
      setQuoteError(e?.message || 'Quote failed.');
    } finally {
      setQuoting(false);
    }
  }, [entry, live, amount, side, networkId, baseDecimals, decimals, tokenSymbol]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const maxBalanceForSide = (): bigint => {
    if (side === 'BUY') return mode === 'PRIVATE' ? privateStrk : publicStrk;
    return mode === 'PRIVATE' ? (privateTokenBalance ?? 0n) : (publicTokenBalance ?? 0n);
  };

  const insufficient = amount.length > 0 && parseTokenAmount(amount, side === 'BUY' ? baseDecimals : decimals) > maxBalanceForSide();

  const execute = async () => {
    if (!connected || !wallet.address || !entry) return;
    setError(null);
    setTxHash(null);
    try {
      setStep('QUOTING');
      const parsed = parseTokenAmount(amount, side === 'BUY' ? baseDecimals : decimals);
      if (parsed <= 0n) throw new Error('Enter an amount greater than zero.');

      let hash: string;
      if (mode === 'PUBLIC') {
        setStep('SIGNING');
        const account = wallet.walletAccount;
        if (!account || typeof account.execute !== 'function') {
          throw new Error('Connected wallet does not support public trades.');
        }
        const res =
          side === 'BUY'
            ? await executePublicBuy(account, base, entry.curve, amount, wallet.address, baseDecimals)
            : await executePublicSell(account, entry.token, entry.curve, amount, wallet.address, decimals);
        hash = res.transactionHash;
      } else {
        setStep('PROVING');
        const plan = {
          operation: side === 'BUY' ? CURVE_OP.BUY : CURVE_OP.SELL,
          inputToken: side === 'BUY' ? base : entry.token,
          outputToken: side === 'BUY' ? entry.token : base,
          amount: parsed.toString(),
          executor: entry.executor,
          userAddress: wallet.address,
        };
        const actions =
          side === 'BUY' ? buildPrivateBuyActions(plan) : buildPrivateSellActions(plan);
        const res = await executePrivateTrade(wallet, actions);
        hash = res.transactionHash;
      }
      setStep('SUBMITTING');
      setTxHash(hash);
      setStep('DONE');
      await refreshAfterMutation();
      await refreshPrivateTokenBalance();
      await refreshBalances();
    } catch (e: any) {
      setError(e?.message || 'Trade failed.');
      setStep(null);
    }
  };

  const metrics = snapshot?.metrics;
  const pct = metrics?.graduationPct ?? 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/launch" className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="w-4 h-4" /> Launch
        </Link>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !entry ? (
          <div className="text-[13px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-xl p-3">{error}</div>
        ) : (
          <>
            {/* Header */}
            <div className="pt-2">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 border border-violet-500/30 flex items-center justify-center text-3xl">
                  {entry.emoji}
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
                    {entry.symbol}
                    {metrics?.graduated && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        GRADUATED
                      </span>
                    )}
                  </h1>
                  <p className="text-sm text-zinc-500">
                    {entry.name} · {shortenAddress(entry.curve, 5)}
                  </p>
                </div>
              </div>
            </div>

            {!live && (
              <div className="text-[13px] text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl p-3">
                This token&apos;s contracts are not deployed/configured yet. Configure
                NEXT_PUBLIC_UMBRA_{entry.symbol}_CURVE / _TOKEN / _EXECUTOR to go live.
              </div>
            )}

            {/* Market stats */}
            {live && metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Price', fmtPriceUsd(metrics.priceUsd)],
                  ['Market Cap', fmtUsd(metrics.marketCap)],
                  ['Liquidity', fmtUsd(metrics.liquidity)],
                  ['Volume', fmtUsd(metrics.volume)],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
                    <div className="text-[15px] font-semibold text-zinc-100 mt-0.5">{val}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Graduation */}
            {live && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between text-[12px] text-zinc-400">
                  <span className="font-medium">Graduation</span>
                  <span>{metrics?.graduated ? 'COMPLETE' : `${pct.toFixed(0)}%`}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${metrics?.graduated ? 'bg-emerald-400' : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-zinc-600">
                  {metrics?.graduated
                    ? 'Trading stopped; reserves moved to the GraduationRouter for DEX liquidity seeding.'
                    : `Reaches graduation at ${formatTokenAmount(snapshot?.curve?.graduationTarget ?? 0n, baseDecimals, 2)} STRK of real reserves.`}
                </div>
              </div>
            )}

            {!connected ? (
              <ConnectGate />
            ) : (
              <>
                {/* Balances */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Public {entry.symbol}</div>
                    <div className="text-[15px] font-semibold text-zinc-100 mt-1">
                      {publicTokenBalance !== null
                        ? formatTokenAmount(publicTokenBalance, decimals, 4)
                        : '—'}
                    </div>
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      Public STRK: {formatTokenAmount(publicStrk, baseDecimals, 4)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-violet-300">Private {entry.symbol} 🛡</div>
                    <div className="text-[15px] font-semibold text-violet-200 mt-1">
                      {privateBalanceStatus === 'OK'
                        ? formatTokenAmount(privateTokenBalance ?? 0n, decimals, 4)
                        : '—'}
                    </div>
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      Private STRK:{' '}
                      {privateStrkAvailable ? formatTokenAmount(privateStrk, baseDecimals, 4) : '—'}
                    </div>
                  </div>
                </div>

                {/* Public / Private mode */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode('PUBLIC')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                      mode === 'PUBLIC'
                        ? 'bg-zinc-100 text-black border-zinc-100'
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Globe className="w-4 h-4" /> Public
                  </button>
                  <button
                    onClick={() => {
                      setMode('PRIVATE');
                      void refreshPrivateTokenBalance();
                    }}
                    disabled={!privateCapable}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                      mode === 'PRIVATE'
                        ? 'bg-violet-500 text-white border-violet-500'
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Shield className="w-4 h-4" /> Private
                  </button>
                </div>

                {mode === 'PRIVATE' && !privateCapable && (
                  <p className="text-[12px] text-zinc-500">
                    Private trades need a STRK20-capable wallet (Ready).
                  </p>
                )}

                {/* Buy / Sell */}
                <div className="grid grid-cols-2 gap-2">
                  {(['BUY', 'SELL'] as Side[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`py-2.5 rounded-xl text-[13px] font-bold border transition-colors ${
                        side === s
                          ? s === 'BUY'
                            ? 'bg-emerald-500 text-black border-emerald-500'
                            : 'bg-rose-500 text-white border-rose-500'
                          : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Amount */}
                <div className="border border-zinc-800 bg-zinc-950/60 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{side === 'BUY' ? `You pay (${baseSymbol})` : `You sell (${tokenSymbol})`}</span>
                    <button
                      onClick={() => setAmount(formatTokenAmount(maxBalanceForSide(), side === 'BUY' ? baseDecimals : decimals, decimals >= 8 ? 6 : 4))}
                      className="hover:text-zinc-200"
                    >
                      Max: {formatTokenAmount(maxBalanceForSide(), side === 'BUY' ? baseDecimals : decimals, 4)}{' '}
                      {side === 'BUY' ? baseSymbol : tokenSymbol}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      className="flex-1 bg-transparent text-2xl font-semibold text-zinc-100 outline-none placeholder:text-zinc-700"
                    />
                    <span className="text-sm text-zinc-400 font-mono">
                      {side === 'BUY' ? baseSymbol : tokenSymbol}
                    </span>
                  </div>

                  {quoting && (
                    <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching on-chain quote…
                    </div>
                  )}
                  {quote && !quoting && (
                    <div className="flex items-center gap-2 text-[13px] text-zinc-300">
                      <span className="text-zinc-500">You receive</span>
                      <span className="font-semibold text-zinc-100">{quote.output}</span>
                      <span className="text-zinc-500">{quote.outputSymbol}</span>
                      {mode === 'PRIVATE' && <Shield className="w-3.5 h-3.5 text-violet-400" />}
                    </div>
                  )}
                  {quoteError && (
                    <div className="flex items-start gap-2 text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2">
                      <X className="w-4 h-4 shrink-0 mt-0.5" /> {quoteError}
                    </div>
                  )}
                  {insufficient && !error && (
                    <p className="text-[12px] text-rose-400">
                      Insufficient {mode === 'PRIVATE' ? 'private' : 'public'} balance.
                    </p>
                  )}
                </div>

                <button
                  onClick={() => void execute()}
                  disabled={!live || !connected || quoting || step !== null || !amount || parseFloat(amount) <= 0 || insufficient}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === 'PRIVATE'
                      ? 'bg-violet-500 hover:bg-violet-400 text-white'
                      : side === 'BUY'
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                        : 'bg-rose-500 hover:bg-rose-400 text-white'
                  }`}
                >
                  {step === 'QUOTING' || step === 'PROVING' ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> {step === 'PROVING' ? 'Proving private trade…' : 'Quoting…'}
                    </span>
                  ) : step === 'SIGNING' ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Signing in wallet…
                    </span>
                  ) : step === 'SUBMITTING' ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                    </span>
                  ) : step === 'DONE' ? (
                    <span className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Submitted
                    </span>
                  ) : (
                    `${mode === 'PRIVATE' ? 'Private' : 'Public'} ${side === 'BUY' ? 'buy' : 'sell'}`
                  )}
                </button>

                {txHash && (
                  <div className="flex items-center justify-between text-[12px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-3 break-all">
                    <span>{txHash}</span>
                    <a
                      href={`${snapshot ? '' : ''}https://voyager.online/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 shrink-0 text-emerald-300 underline"
                    >
                      View
                    </a>
                  </div>
                )}

                {error && (
                  <div className="text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3 break-words">
                    {error}
                  </div>
                )}

                {/* Privacy explainer */}
                <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                    <ShieldCheck className="w-4 h-4 text-violet-400" /> Privacy is a property of the trade,
                    not the market.
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">The market stays public</div>
                      <ul className="mt-1 space-y-0.5 text-zinc-300">
                        <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Price</li>
                        <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Liquidity</li>
                        <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Curve state & market impact</li>
                        <li className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Graduation progress</li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Private execution protects</div>
                      <ul className="mt-1 space-y-0.5 text-zinc-300">
                        <li className="flex items-center gap-1.5"><span className="text-violet-400">🛡</span> Shielded input (STRK20 note)</li>
                        <li className="flex items-center gap-1.5"><span className="text-violet-400">🛡</span> Shielded output (STRK20 note)</li>
                        <li className="flex items-center gap-1.5"><span className="text-violet-400">🛡</span> Reduced direct wallet → trade linkage</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {mode === 'PRIVATE' && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-300">
                      <AlertTriangle className="w-4 h-4" /> Privacy warnings — please read
                    </div>
                    <ul className="mt-2 text-[12px] text-zinc-300 space-y-1">
                      <li>• Transaction timing and size are still publicly visible.</li>
                      <li>• A fresh shield + trade in the same wallet can be correlated (note maturity).</li>
                      <li>• Your wallet address pays gas and signs the proof — a determined observer can link it.</li>
                      <li>• This reduces direct wallet → trade linkage; it is not absolute anonymity.</li>
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-zinc-600">
                  {mode === 'PUBLIC'
                    ? 'Public execution: your wallet trades directly on the canonical curve. Price and liquidity are shared with everyone.'
                    : 'Private execution: STRK20 shielded input → PrivateCurveExecutor → the SAME public curve → shielded output note. One market, two execution layers.'}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}