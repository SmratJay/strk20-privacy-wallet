'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ShieldOff,
  ExternalLink,
  Activity,
  LineChart,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import PriceChart from '@/components/launch/PriceChart';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
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
  findTokenEntry,
  readPriceHistory,
  PricePoint,
  readRecentTrades,
  TradeEvent,
  readPrivateStats,
  readMigratedState,
  maxTradeTokenOut,
} from '@/services/launchService';
import {
  buildPrivateBuyActions,
  buildPrivateSellActions,
  executePrivateTrade,
  shieldLaunchToken,
  unshieldLaunchToken,
  CURVE_OP,
} from '@/services/privateLaunchService';
import { strk20WalletApiService } from '@/services/strk20WalletApiService';
import { fetchMetadataByToken, LaunchMetadataRecord } from '@/services/launchMetadata';
import { formatTokenAmount, parseTokenAmount, shortenAddress } from '@/utils/formatters';

type Side = 'BUY' | 'SELL';
type Mode = 'PUBLIC' | 'PRIVATE';
type Step = 'QUOTING' | 'SIGNING' | 'PROVING' | 'SUBMITTING' | 'DONE';
type PrivacyAsset = 'TOKEN' | 'STRK';
type PrivacyAction = 'SHIELD' | 'UNSHIELD';

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
  const { wallet, networkId, balances, refreshAfterMutation, isSepolia } = useWallet();

  const net = getLaunchNetwork(networkId);
  const explorerUrl = isSepolia ? 'https://sepolia.voyager.online' : 'https://voyager.online';
  const [entry, setEntry] = useState<LaunchTokenEntry | null>(null);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [offchainMetadata, setOffchainMetadata] = useState<LaunchMetadataRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const [side, setSide] = useState<Side>('BUY');
  const [mode, setMode] = useState<Mode>('PUBLIC');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ output: string; outputSymbol: string; error?: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicTokenBalance, setPublicTokenBalance] = useState<bigint | null>(null);
  const [privateTokenBalance, setPrivateTokenBalance] = useState<bigint | null>(null);
  const [privateBalanceStatus, setPrivateBalanceStatus] = useState<'UNKNOWN' | 'OK' | 'ERR'>('UNKNOWN');

  // V2 analytics: price history, trades, private stats, migration truth.
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [privateStats, setPrivateStats] = useState<{ tradeCount: bigint; volumeBase: bigint } | null>(null);
  const [migrated, setMigrated] = useState<boolean | null>(null);

  const base = net.baseAsset;
  const baseSymbol = 'STRK';
  const baseDecimals = net.baseAssetDecimals;

  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null && privy.viewingKey !== null;

  const [privateStrk, setPrivateStrk] = useState<bigint>(0n);
  const [privateStrkAvailable, setPrivateStrkAvailable] = useState(false);

  // Privacy management panel state.
  const [privacyAsset, setPrivacyAsset] = useState<PrivacyAsset>('TOKEN');
  const [privacyAmount, setPrivacyAmount] = useState('');
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacyTx, setPrivacyTx] = useState<string | null>(null);

  const refreshPrivateStrk = useCallback(async () => {
    if (privyConnected) {
      try {
        const b = await privy.getPrivateBalance(base);
        setPrivateStrk(b);
        setPrivateStrkAvailable(true);
      } catch {
        setPrivateStrkAvailable(false);
      }
      return;
    }
    const row = balances.find((b) => b.token.address.toLowerCase() === base.toLowerCase());
    setPrivateStrk(row?.shieldedBalance ?? 0n);
    setPrivateStrkAvailable(row?.shieldedBalanceAvailable === true);
  }, [privyConnected, privy, base, balances]);

  useEffect(() => {
    void refreshPrivateStrk();
  }, [refreshPrivateStrk]);

  useEffect(() => {
    const t = setInterval(() => void refreshPrivateStrk(), 10000);
    return () => clearInterval(t);
  }, [refreshPrivateStrk]);

  const [publicStrk, setPublicStrk] = useState<bigint | null>(null);
  const [publicStrkStatus, setPublicStrkStatus] = useState<'UNKNOWN' | 'OK' | 'ERR'>('UNKNOWN');

  const refreshPublicStrk = useCallback(async () => {
    if (!wallet.address) {
      setPublicStrk(null);
      setPublicStrkStatus('UNKNOWN');
      return;
    }
    try {
      const b = await getTokenBalance(networkId, base, wallet.address);
      if (b !== null) {
        setPublicStrk(b);
        setPublicStrkStatus('OK');
      } else {
        setPublicStrkStatus('ERR');
      }
    } catch {
      setPublicStrkStatus('ERR');
    }
  }, [wallet.address, networkId, base]);

  useEffect(() => {
    void refreshPublicStrk();
  }, [refreshPublicStrk, snapshot?.curve?.priceBase]);

  useEffect(() => {
    const t = setInterval(() => void refreshPublicStrk(), 8000);
    return () => clearInterval(t);
  }, [refreshPublicStrk]);

  const live = entry ? isTokenLive(entry) : false;
  const decimals = snapshot?.metadata?.decimals ?? 18;
  const tokenSymbol = snapshot?.metadata?.symbol ?? entry?.symbol ?? 'TOKEN';

  // Load entry + snapshot from the live factory.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const found = await findTokenEntry(networkId, id);
        if (cancelled) return;
        if (!found) {
          setError(`No memecoin found for "${id}".`);
          setEntry(null);
          return;
        }
        setEntry(found);
        const snap = await loadTokenSnapshot(networkId, found);
        if (!cancelled) setSnapshot(snap);
        const meta = await fetchMetadataByToken(found.token);
        if (!cancelled) setOffchainMetadata(meta);
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

  // V2 analytics refresh.
  const refreshAnalytics = useCallback(async () => {
    if (!entry || !isTokenLive(entry)) return;
    const [hist, tr, priv, mig] = await Promise.all([
      readPriceHistory(networkId, entry.curve),
      readRecentTrades(networkId, entry.curve, entry.executor),
      readPrivateStats(networkId, entry.executor),
      readMigratedState(networkId, entry.curve),
    ]);
    setPriceHistory(hist);
    setTrades(tr);
    setPrivateStats(priv);
    setMigrated(mig);
  }, [entry, networkId]);

  useEffect(() => {
    void refreshAnalytics();
  }, [refreshAnalytics]);

  useEffect(() => {
    const t = setInterval(() => void refreshAnalytics(), 15000);
    return () => clearInterval(t);
  }, [refreshAnalytics]);

  // Public/private token balances.
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

  const refreshPrivateTokenBalance = useCallback(async () => {
    if (!entry) return;
    try {
      if (privyConnected) {
        const bal = await privy.getPrivateBalance(entry.token);
        setPrivateTokenBalance(bal);
      } else {
        const entries = await strk20WalletApiService.getPrivateBalances(wallet, [entry.token]);
        const row = entries.find((e) => e.token.toLowerCase() === entry.token.toLowerCase());
        setPrivateTokenBalance(row?.balance ?? 0n);
      }
      setPrivateBalanceStatus('OK');
    } catch {
      setPrivateBalanceStatus('ERR');
    }
  }, [entry, wallet, privyConnected, privy]);

  useEffect(() => {
    void refreshPrivateTokenBalance();
  }, [refreshPrivateTokenBalance]);

  const connected = wallet.isConnected;
  const privateCapable = connected && !!(wallet.walletAccount || wallet.rawWallet);

  const refreshQuote = useCallback(async () => {
    if (!entry || !live || !amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    setQuote(null);
    try {
      const parsed = parseTokenAmount(amount, side === 'BUY' ? baseDecimals : decimals);
      let output: bigint | null = null;
      if (side === 'BUY') output = await quoteBuy(networkId, entry.curve, parsed);
      else output = await quoteSell(networkId, entry.curve, parsed);
      if (output === null) {
        setQuote({
          output: '',
          outputSymbol: side === 'BUY' ? tokenSymbol : baseSymbol,
          error: side === 'BUY'
            ? 'Order too large for one trade (single buys are capped at 10% of the token reserve).'
            : 'Could not fetch an on-chain quote for this amount.',
        });
        return;
      }
      setQuote({
        output: formatTokenAmount(output, side === 'BUY' ? decimals : baseDecimals, decimals >= 8 ? 6 : 4),
        outputSymbol: side === 'BUY' ? tokenSymbol : baseSymbol,
      });
    } catch (e: any) {
      setQuote({
        output: '',
        outputSymbol: side === 'BUY' ? tokenSymbol : baseSymbol,
        error: e?.message || 'Quote failed.',
      });
    } finally {
      setQuoting(false);
    }
  }, [entry, live, amount, side, networkId, baseDecimals, decimals, tokenSymbol]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const maxTradeCap = snapshot?.curve ? maxTradeTokenOut(snapshot.curve) : 0n;
  const maxBalanceForSide = (): bigint => {
    if (side === 'BUY') return mode === 'PRIVATE' ? privateStrk : (publicStrk ?? 0n);
    return mode === 'PRIVATE' ? (privateTokenBalance ?? 0n) : (publicTokenBalance ?? 0n);
  };

  const balanceKnown =
    (side === 'BUY' && mode === 'PUBLIC' && publicStrkStatus === 'OK') ||
    (side === 'BUY' && mode === 'PRIVATE' && privateStrkAvailable) ||
    (side === 'SELL' && mode === 'PUBLIC' && publicTokenBalance !== null) ||
    (side === 'SELL' && mode === 'PRIVATE' && privateBalanceStatus === 'OK');
  const insufficient =
    balanceKnown &&
    amount.length > 0 &&
    parseTokenAmount(amount, side === 'BUY' ? baseDecimals : decimals) > maxBalanceForSide();

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
        if (privyConnected) {
          const res = await privy.privateTrade({
            operation: side === 'BUY' ? CURVE_OP.BUY : CURVE_OP.SELL,
            curveExecutor: entry.executor,
            inputToken: side === 'BUY' ? base : entry.token,
            outputToken: side === 'BUY' ? entry.token : base,
            amount: parsed,
          });
          hash = res.transactionHash;
        } else {
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
      }
      setStep('SUBMITTING');
      setTxHash(hash);
      setStep('DONE');
      await refreshAfterMutation();
      await refreshPrivateTokenBalance();
      await refreshBalances();
      await refreshAnalytics();
    } catch (e: any) {
      setError(e?.message || 'Trade failed.');
      setStep(null);
    }
  };

  const runPrivacyAction = async (action: PrivacyAction) => {
    if (!connected || !wallet.address || !entry) return;
    setPrivacyError(null);
    setPrivacyTx(null);
    const parsed = parseTokenAmount(
      privacyAmount,
      privacyAsset === 'TOKEN' ? decimals : baseDecimals,
    );
    if (parsed <= 0n) {
      setPrivacyError('Enter an amount greater than zero.');
      return;
    }
    const token = privacyAsset === 'TOKEN' ? entry.token : base;
    setPrivacyBusy(true);
    try {
      const res =
        action === 'SHIELD'
          ? await shieldLaunchToken({ wallet, privy, privyConnected, token, amountBase: parsed })
          : await unshieldLaunchToken({
              wallet,
              privy,
              privyConnected,
              token,
              amountBase: parsed,
              recipient: wallet.address,
            });
      setPrivacyTx(res.transactionHash);
      await refreshAfterMutation();
      await refreshPrivateTokenBalance();
      await refreshPrivateStrk();
      await refreshBalances();
      setPrivacyAmount('');
    } catch (e: any) {
      setPrivacyError(e?.message || `${action === 'SHIELD' ? 'Shield' : 'Unshield'} failed.`);
    } finally {
      setPrivacyBusy(false);
    }
  };

  const metrics = snapshot?.metrics;
  const pct = metrics?.graduationPct ?? 0;
  const graduated = metrics?.graduated ?? false;
  const curve = snapshot?.curve;
  const feePct = curve ? (Number(curve.feeBps) / 100).toFixed(2) : '1.00';
  const creatorFeePct = curve ? (Number(curve.creatorFeeBps) / 100).toFixed(2) : '0.25';
  const protocolFeePct = curve ? (Number(curve.protocolFeeBps) / 100).toFixed(2) : '0.25';
  const privateVolumePct = useMemo(() => {
    if (!privateStats || !metrics?.volume || metrics.volume <= 0) return null;
    // privateStats.volumeBase is in smallest units; metrics.volume is in STRK.
    const privateVolumeStrk = Number(privateStats.volumeBase) / 1e18;
    const share = (privateVolumeStrk / metrics.volume) * 100;
    return Math.min(100, Math.max(0, share));
  }, [privateStats, metrics]);

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/explore" className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-zinc-200">
          <ArrowLeft className="w-4 h-4" /> Explore
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
                {offchainMetadata?.image ? (
                  <img
                    src={offchainMetadata.image}
                    alt={`${entry.symbol} artwork`}
                    className="w-14 h-14 rounded-2xl object-cover border border-zinc-800"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 border border-violet-500/30 flex items-center justify-center text-3xl">
                    {entry.emoji}
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2 flex-wrap">
                    {entry.symbol}
                    {graduated && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        CURVE GRADUATED
                      </span>
                    )}
                    {graduated && migrated === true && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        LIQUIDITY MIGRATED
                      </span>
                    )}
                  </h1>
                  <p className="text-sm text-zinc-500">
                    {offchainMetadata?.name || entry.name} · {shortenAddress(entry.curve, 5)}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                    {entry.creator && (
                      <span>
                        Creator <span className="text-violet-300 font-mono">{shortenAddress(entry.creator, 4)}</span>
                      </span>
                    )}
                    {(offchainMetadata?.socials?.x ||
                      offchainMetadata?.socials?.telegram ||
                      offchainMetadata?.socials?.website) && (
                      <span className="flex items-center gap-2">
                        {offchainMetadata.socials.x && (
                          <a href={offchainMetadata.socials.x} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:underline">
                            X
                          </a>
                        )}
                        {offchainMetadata.socials.telegram && (
                          <a href={offchainMetadata.socials.telegram} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:underline">
                            TG
                          </a>
                        )}
                        {offchainMetadata.socials.website && (
                          <a href={offchainMetadata.socials.website} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:underline">
                            Web
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {offchainMetadata?.description && (
                <p className="mt-3 text-[13px] text-zinc-400 leading-relaxed max-w-2xl">
                  {offchainMetadata.description}
                </p>
              )}
            </div>

            {/* Contract addresses */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Contracts (on-chain)</div>
              {[
                ['Token', entry.token, `${explorerUrl}/contract/${entry.token}`],
                ['Curve', entry.curve, `${explorerUrl}/contract/${entry.curve}`],
                ['Private executor', entry.executor, `${explorerUrl}/contract/${entry.executor}`],
              ].map(([label, addr, url]) => (
                <div key={label} className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-500 w-32">{label}</span>
                  <span className="font-mono text-zinc-300 truncate">{shortenAddress(addr, 10)}</span>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200 shrink-0 ml-2">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ))}
            </div>

            {!live && (
              <div className="text-[13px] text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl p-3">
                This token&apos;s contracts are not configured yet. Set
                NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY to go live.
              </div>
            )}

            {/* Chart */}
            {live && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-[12px] text-zinc-400">
                    <LineChart className="w-4 h-4 text-violet-400" /> Price history (on-chain trades)
                  </div>
                  {metrics && (
                    <div className="text-[12px] text-zinc-300">
                      {fmtPriceUsd(metrics.priceUsd)}
                      <span className="text-zinc-600 ml-1">STRK {metrics.price.toExponential(3)}</span>
                    </div>
                  )}
                </div>
                <PriceChart points={priceHistory} />
              </div>
            )}

            {/* Market stats */}
            {live && metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Price', fmtPriceUsd(metrics.priceUsd)],
                  ['Market Cap', fmtUsd(metrics.marketCap)],
                  ['Liquidity', fmtUsd(metrics.liquidity)],
                  ['Volume (cumulative)', fmtUsd(metrics.volume)],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
                    <div className="text-[15px] font-semibold text-zinc-100 mt-0.5">{val}</div>
                  </div>
                ))}
              </div>
            )}

            {live && privateStats && privateVolumePct !== null && (
              <div className="flex items-center gap-2 text-[11px] text-violet-300/80 border border-violet-500/20 bg-violet-500/5 rounded-xl px-3 py-2">
                <Shield className="w-3.5 h-3.5" />
                Private execution: {privateStats.tradeCount.toString()} trade(s) ·{' '}
                {privateVolumePct.toFixed(1)}% of traded volume ran through the shielded STRK20 lane.
              </div>
            )}

            {/* Graduation */}
            {live && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between text-[12px] text-zinc-400">
                  <span className="font-medium">Graduation</span>
                  <span>
                    {graduated
                      ? migrated === true
                        ? 'CURVE GRADUATED · LIQUIDITY MIGRATED'
                        : 'CURVE GRADUATED · awaiting migration'
                      : `${pct.toFixed(0)}%`}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      graduated
                        ? migrated === true
                          ? 'bg-sky-400'
                          : 'bg-emerald-400'
                        : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                    }`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-zinc-600">
                  {graduated ? (
                    migrated === true ? (
                      'The curve graduated and its reserves were forwarded to the DEX liquidity boundary.'
                    ) : (
                      'The curve graduated and its reserves are held by the GraduationRouter. Migration forwards them to the liquidity manager.'
                    )
                  ) : (
                    <>
                      Reaches graduation at{' '}
                      {formatTokenAmount(snapshot?.curve?.graduationTarget ?? 0n, baseDecimals, 2)} STRK of
                      real reserves. The trade that crosses the target closes the curve automatically.
                    </>
                  )}
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
                      Public STRK:{' '}
                      {publicStrkStatus === 'OK'
                        ? formatTokenAmount(publicStrk ?? 0n, baseDecimals, 4)
                        : publicStrkStatus === 'ERR'
                          ? 'unavailable'
                          : '—'}
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
                      {quote.error ? (
                        <span className="text-amber-400">{quote.error}</span>
                      ) : (
                        <>
                          <span className="text-zinc-500">You receive</span>
                          <span className="font-semibold text-zinc-100">{quote.output}</span>
                          <span className="text-zinc-500">{quote.outputSymbol}</span>
                          {mode === 'PRIVATE' && <Shield className="w-3.5 h-3.5 text-violet-400" />}
                        </>
                      )}
                    </div>
                  )}

                  {/* Fee breakdown (real on-chain curve params) */}
                  {curve && !graduated && (
                    <div className="text-[11px] text-zinc-600 space-y-0.5">
                      <div className="flex justify-between">
                        <span>Fee on this trade</span>
                        <span className="font-mono text-zinc-400">{feePct}% (in STRK)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Creator</span>
                        <span className="font-mono text-zinc-400">{creatorFeePct}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Protocol</span>
                        <span className="font-mono text-zinc-400">{protocolFeePct}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Retained as liquidity</span>
                        <span className="font-mono text-zinc-400">
                          {(Number(curve.feeBps) - Number(curve.creatorFeeBps) - Number(curve.protocolFeeBps)) / 100}%
                        </span>
                      </div>
                    </div>
                  )}
                  {side === 'BUY' && maxTradeCap > 0n && !graduated && (
                    <p className="text-[11px] text-zinc-600">
                      Single buys are capped at {formatTokenAmount(maxTradeCap, decimals, 2)} {tokenSymbol} (10% of the
                      token reserve).
                    </p>
                  )}
                  {insufficient && !error && (
                    <p className="text-[12px] text-rose-400">
                      Insufficient {mode === 'PRIVATE' ? 'private' : 'public'} balance.
                    </p>
                  )}
                </div>

                <button
                  onClick={() => void execute()}
                  disabled={!live || !connected || quoting || step !== null || !amount || parseFloat(amount) <= 0 || insufficient || graduated}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    mode === 'PRIVATE'
                      ? 'bg-violet-500 hover:bg-violet-400 text-white'
                      : side === 'BUY'
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                        : 'bg-rose-500 hover:bg-rose-400 text-white'
                  }`}
                >
                  {graduated ? (
                    'Curve graduated — trading closed'
                  ) : step === 'QUOTING' || step === 'PROVING' ? (
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
                      href={`${explorerUrl}/tx/${txHash}`}
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

                {/* Shield / Unshield */}
                {!graduated && (
                  <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                      <ShieldCheck className="w-4 h-4 text-violet-400" /> Shield / Unshield
                    </div>
                    <p className="text-[12px] text-zinc-400 leading-relaxed">
                      Your {entry.symbol} balance is the SAME standard ERC20 whether public or private.
                      Shielding moves it into a STRK20 note in the privacy pool; unshielding returns it to
                      your public wallet. No wrapped token is involved.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(['TOKEN', 'STRK'] as PrivacyAsset[]).map((a) => (
                        <button
                          key={a}
                          onClick={() => setPrivacyAsset(a)}
                          className={`py-2 rounded-lg text-[12px] font-semibold border transition-colors ${
                            privacyAsset === a
                              ? 'bg-violet-500 text-white border-violet-500'
                              : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          {a === 'TOKEN' ? entry.symbol : 'STRK'}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={privacyAmount}
                        onChange={(e) => setPrivacyAmount(e.target.value)}
                        placeholder={`0.0 ${privacyAsset === 'TOKEN' ? entry.symbol : 'STRK'}`}
                        className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                      />
                      <button
                        onClick={() => void runPrivacyAction('SHIELD')}
                        disabled={privacyBusy || !connected}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-[13px] font-bold px-4 py-2.5 disabled:opacity-40"
                      >
                        <Shield className="w-4 h-4" /> Shield
                      </button>
                      <button
                        onClick={() => void runPrivacyAction('UNSHIELD')}
                        disabled={privacyBusy || !connected}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/40 text-violet-200 text-[13px] font-bold px-4 py-2.5 hover:bg-violet-500/10 disabled:opacity-40"
                      >
                        <ShieldOff className="w-4 h-4" /> Unshield
                      </button>
                    </div>
                    {privacyBusy && (
                      <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting STRK20 proof…
                      </div>
                    )}
                    {privacyTx && (
                      <div className="flex items-center justify-between text-[12px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-2 break-all">
                        <span>{privacyTx}</span>
                        <a href={`${explorerUrl}/tx/${privacyTx}`} target="_blank" rel="noopener noreferrer" className="ml-2 shrink-0 text-emerald-300 underline">
                          View
                        </a>
                      </div>
                    )}
                    {privacyError && (
                      <div className="text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2 break-words">
                        {privacyError}
                      </div>
                    )}
                  </div>
                )}

                {/* Trades */}
                {live && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100 mb-2">
                      <Activity className="w-4 h-4 text-violet-400" /> Recent trades (on-chain)
                    </div>
                    {trades.length === 0 ? (
                      <div className="text-[12px] text-zinc-600">No trades yet.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {trades.map((t, i) => (
                          <div key={`${t.txHash}-${i}`} className="flex items-center justify-between text-[12px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  t.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {t.side}
                              </span>
                              {t.private ? (
                                <span className="inline-flex items-center gap-1 text-violet-300/80">
                                  <Shield className="w-3 h-3" /> private
                                </span>
                              ) : (
                                <span className="text-zinc-500 font-mono">{shortenAddress(t.trader, 4)}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-zinc-400 font-mono shrink-0">
                              <span>
                                {formatTokenAmount(t.input, t.side === 'BUY' ? baseDecimals : decimals, 4)}{' '}
                                {t.side === 'BUY' ? baseSymbol : tokenSymbol}
                              </span>
                              <span className="text-zinc-600">→</span>
                              <span className="text-zinc-200">
                                {formatTokenAmount(t.output, t.side === 'BUY' ? decimals : baseDecimals, 4)}{' '}
                                {t.side === 'BUY' ? tokenSymbol : baseSymbol}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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