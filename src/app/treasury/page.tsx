'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Loader2,
  Shield,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Clock,
  RefreshCw,
  Activity,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { ActionProposal } from '@/ai/schema';
import { PortfolioSummary, PrivateBalanceRow, buildPortfolioSummary } from '@/ai/portfolio';
import { PolicyVerdict, TreasuryPolicy } from '@/ai/policy';
import { AssetPrice, resolvePortfolioPrices } from '@/ai/prices';
import { executeProposal, tokenSymbols, resolvePrivateTreasuryAddress, ExecutionResult } from '@/services/treasuryService';
import { strk20WalletApiService } from '@/services/strk20WalletApiService';
import { shortenAddress, formatTokenAmount } from '@/utils/formatters';

interface AnalyzeResponse {
  summary: PortfolioSummary;
  proposal: ActionProposal;
  verdict: PolicyVerdict;
  policy: TreasuryPolicy;
  addresses: { userAddress: string; privateTreasuryAddress: string; verification: 'privy' | 'client-claimed' };
  trust: { balances: string; note: string };
  proposalGeneratedAt: number;
  proposalExpiresAt: number;
}

type AnalyzeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; analysis: AnalyzeResponse };

type ExecuteState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'success'; result: Extract<ExecutionResult, { ok: true }> }
  | { status: 'failure'; reason: string; detail: string };

function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v === 0) return '—';
  return `$${v.toFixed(2)}`;
}

function canonicalToken(token: string): string {
  return token.toLowerCase();
}

export default function TreasuryPage() {
  const { wallet, refreshAfterMutation, transactions, recordTransaction } = useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null && privy.viewingKey !== null;

  const [balances, setBalances] = useState<PrivateBalanceRow[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [priceStatus, setPriceStatus] = useState<Record<string, AssetPrice>>({});
  const [loadingBalances, setLoadingBalances] = useState(true);

  const [prompt, setPrompt] = useState('');
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ status: 'idle' });
  const [executeState, setExecuteState] = useState<ExecuteState>({ status: 'idle' });
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const analysisBalancesRef = useRef<PrivateBalanceRow[]>([]);

  const connected = wallet.isConnected;

  // The STRK20 private treasury identity: the Ready-derived account (the address the
  // existing STRK20 integration uses as its `user`/private-note owner and the SOURCE of
  // every private transfer). For the Ready lane the connected account IS the identity.
  const privateTreasuryAddress = resolvePrivateTreasuryAddress({
    privyConnected,
    privyAccountAddress: privy.account?.address,
    privyAddress: privy.address,
    walletAddress: wallet.address,
  });

  const refreshBalances = useCallback(async () => {
    if (!connected) return;
    const rows: PrivateBalanceRow[] = [];
    try {
      if (privyConnected) {
        for (const t of SEPOLIA_TOKENS) {
          try {
            const b = await privy.getPrivateBalance(t.address);
            if (b > 0n) rows.push({ token: t.address, balance: b });
          } catch {
            // token read failed — skip, the summary simply omits it
          }
        }
      } else {
        const entries = await strk20WalletApiService.getPrivateBalances(
          wallet,
          SEPOLIA_TOKENS.map((t) => t.address),
        );
        for (const e of entries) if (e.balance > 0n) rows.push({ token: e.token, balance: e.balance });
      }
    } catch {
      // wallet/STRK20 read failed — keep prior state
    }
    setBalances(rows);
    const symbols = tokenSymbols(rows);
    const bySymbol = await resolvePortfolioPrices(symbols).catch(() => ({} as Record<string, AssetPrice>));
    const prices: Record<string, AssetPrice> = {};
    for (const r of rows) {
      const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(r.token));
      if (meta && bySymbol[meta.symbol]) prices[r.token.toLowerCase()] = bySymbol[meta.symbol];
    }
    setPriceStatus(prices);
    setSummary(buildPortfolioSummary(rows, prices));
  }, [connected, privyConnected, privy, wallet]);

  useEffect(() => {
    if (!connected) return;
    setLoadingBalances(true);
    void refreshBalances().finally(() => setLoadingBalances(false));
  }, [connected, refreshBalances]);

  // Expiry countdown for a completed analysis.
  useEffect(() => {
    if (analyzeState.status !== 'done') {
      setExpiresIn(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((analyzeState.analysis.proposalExpiresAt - Date.now()) / 1000));
      setExpiresIn(left);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [analyzeState]);

  const analyze = async () => {
    if (!connected || !prompt.trim() || analyzeState.status === 'loading') return;
    setExecuteState({ status: 'idle' });
    setAnalyzeState({ status: 'loading' });
    try {
      const rows = await (async (): Promise<PrivateBalanceRow[]> => {
        if (privyConnected) {
          const out: PrivateBalanceRow[] = [];
          for (const t of SEPOLIA_TOKENS) {
            try {
              const b = await privy.getPrivateBalance(t.address);
              if (b > 0n) out.push({ token: t.address, balance: b });
            } catch {
              // skip
            }
          }
          return out;
        }
        const entries = await strk20WalletApiService.getPrivateBalances(
          wallet,
          SEPOLIA_TOKENS.map((t) => t.address),
        );
        return entries.filter((e) => e.balance > 0n).map((e) => ({ token: e.token, balance: e.balance }));
      })();
      analysisBalancesRef.current = rows;

      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          balances: rows,
          context: { userAddress: wallet.address ?? '', privateTreasuryAddress },
        }),
      });
      const json = (await res.json()) as AnalyzeResponse & { error?: string };
      if (!res.ok) {
        setAnalyzeState({ status: 'error', message: json.error ?? 'Analysis failed. Please try again.' });
        return;
      }
      setAnalyzeState({ status: 'done', analysis: json });
    } catch (e) {
      setAnalyzeState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Analysis failed. Please try again.',
      });
    }
  };

  const confirm = async () => {
    if (analyzeState.status !== 'done' || executeState.status === 'running') return;
    const { proposal, proposalExpiresAt, policy } = analyzeState.analysis;
    setExecuteState({ status: 'running' });
    try {
      // 1. Re-fetch CURRENT wallet/STRK20 state.
      const currentBalances = await (async (): Promise<PrivateBalanceRow[]> => {
        if (privyConnected) {
          const out: PrivateBalanceRow[] = [];
          for (const t of SEPOLIA_TOKENS) {
            try {
              const b = await privy.getPrivateBalance(t.address);
              if (b > 0n) out.push({ token: t.address, balance: b });
            } catch {
              // skip
            }
          }
          return out;
        }
        const entries = await strk20WalletApiService.getPrivateBalances(
          wallet,
          SEPOLIA_TOKENS.map((t) => t.address),
        );
        return entries.filter((e) => e.balance > 0n).map((e) => ({ token: e.token, balance: e.balance }));
      })();

      // 2. Execute ONLY through the existing STRK20 privateTransfer path.
      const executeTransfer = async (opts: { amountBase: bigint; token: string; recipient: string }) => {
        if (privyConnected) {
          const res = await privy.transfer(opts.token, opts.amountBase, opts.recipient);
          return { transactionHash: res.transactionHash };
        }
        return strk20WalletApiService.privateTransfer(wallet, opts.token, opts.amountBase, opts.recipient);
      };

      const result = await executeProposal({
        proposal,
        proposalExpiresAt,
        policy,
        analysisBalances: analysisBalancesRef.current,
        currentBalances,
        resolvePrices: async () => {
          const symbols = tokenSymbols(currentBalances);
          const bySymbol = await resolvePortfolioPrices(symbols);
          const prices: Record<string, AssetPrice> = {};
          for (const r of currentBalances) {
            const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(r.token));
            if (meta && bySymbol[meta.symbol]) prices[r.token.toLowerCase()] = bySymbol[meta.symbol];
          }
          return prices;
        },
        executeTransfer,
      });

      if (!result.ok) {
        setExecuteState({ status: 'failure', reason: result.reason, detail: result.detail });
        // A changed/expired/rejected state means the analysis is no longer valid.
        if (result.reason !== 'EXECUTION_FAILED') setAnalyzeState({ status: 'idle' });
        return;
      }

      // 3. Record treasury activity + refresh balances.
      const tokenSymbol = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(proposal.action.asset))?.symbol ?? 'TOKEN';
      const decimals = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(proposal.action.asset))?.decimals ?? 18;
      recordTransaction({
        id: `treasury-${Date.now()}`,
        type: 'PRIVATE_TRANSFER',
        txHash: result.transactionHash,
        timestamp: Date.now(),
        tokenSymbol,
        amount: formatTokenAmount(result.amountBaseUnits, decimals, 6),
        recipient: proposal.action.recipient,
        status: 'CONFIRMED',
        isPrivate: true,
        privacyDetails: 'AI Treasury Rebalance',
      });
      setExecuteState({ status: 'success', result });
      await refreshAfterMutation();
      await refreshBalances();
    } catch (e) {
      setExecuteState({
        status: 'failure',
        reason: 'EXECUTION_FAILED',
        detail: e instanceof Error ? e.message : 'Execution failed.',
      });
    }
  };

  const treasuryActivity = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'PRIVATE_TRANSFER')
        .slice(0, 6)
        .map((t) => ({ ...t })),
    [transactions],
  );

  const analysis = analyzeState.status === 'done' ? analyzeState.analysis : null;
  const verdict = analysis?.verdict ?? null;
  const action = analysis?.proposal.action ?? null;
  const analysisExpired = expiresIn !== null && expiresIn <= 0;

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / TREASURY</div>
            <h1 className="product-page-title flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-400" /> Private AI Treasury
            </h1>
            <p className="product-page-description">
              Your STRK20 private portfolio, analyzed by an AI copilot behind a{' '}
              <span className="text-violet-300">deterministic safety policy</span> — you always confirm before anything moves.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-500 rounded-xl border border-zinc-800 px-3 py-2">
            <Shield className="w-4 h-4 text-violet-400" />
            Treasury identity
            <span className="font-mono text-zinc-300">{privateTreasuryAddress ? shortenAddress(privateTreasuryAddress, 6) : '—'}</span>
          </div>
        </div>

        {!connected ? (
          <ConnectGate />
        ) : (
          <>
            {/* Portfolio overview */}
            <div className="grid sm:grid-cols-3 gap-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Treasury value</div>
                <div className="text-[22px] font-bold text-zinc-100 mt-1">
                  {loadingBalances ? '…' : summary ? fmtUsd(summary.totalUsd) : '—'}
                </div>
                <div className="text-[11px] text-zinc-600 mt-1">
                  {Object.values(priceStatus).some((p) => p.source === 'static' && p.priceUsd > 0)
                    ? 'includes fallback prices (advisory)'
                    : 'prices from live market feed'}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Liquid</div>
                <div className="text-[22px] font-bold text-emerald-300 mt-1">
                  {loadingBalances ? '…' : summary ? fmtUsd(summary.liquidityUsd) : '—'}
                </div>
                <div className="text-[11px] text-zinc-600 mt-1">
                  {summary ? `${summary.liquidPct.toFixed(0)}% of treasury` : 'usable for liquidity policy'}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Top position</div>
                <div className="text-[22px] font-bold text-zinc-100 mt-1">
                  {loadingBalances ? '…' : summary?.topAsset ? `${summary.topAsset.symbol} · ${summary.topAsset.pct.toFixed(0)}%` : '—'}
                </div>
                <div className="text-[11px] text-zinc-600 mt-1">
                  concentration limit {60}% per policy
                </div>
              </div>
            </div>

            {/* Positions */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Private positions</div>
              {loadingBalances ? (
                <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading STRK20 balances…
                </div>
              ) : !summary || summary.positions.length === 0 ? (
                <div className="text-[12px] text-zinc-600">
                  No private balances yet. Shield funds in your wallet, then ask the copilot.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {summary.positions.map((p) => (
                    <div key={p.token} className="flex items-center justify-between text-[13px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-100">{p.symbol}</span>
                        <span className="text-zinc-500 font-mono">
                          {p.balanceHuman.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-400">{fmtUsd(p.usdValue)}</span>
                        <span className="text-zinc-600 w-12 text-right">{p.pct.toFixed(1)}%</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            p.priceSource === 'avnu' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {p.priceSource === 'avnu' ? 'live' : 'fallback'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Sparkles className="w-4 h-4 text-violet-400" /> Ask your treasury copilot
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder="e.g. Make my treasury safer while keeping $1,000 liquid."
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-600 resize-none"
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setPrompt('Make my treasury safer while keeping at least $1,000 liquid.')}
                  className="inline-flex items-center gap-1.5 text-[12px] text-violet-300 hover:text-violet-200 border border-violet-500/30 rounded-lg px-3 py-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Make my treasury safer
                </button>
                <button
                  onClick={() => void analyze()}
                  disabled={analyzeState.status === 'loading' || !prompt.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-[13px] font-bold px-4 py-2.5 disabled:opacity-40"
                >
                  {analyzeState.status === 'loading' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      Analyze <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Analysis result */}
            {analyzeState.status === 'error' && (
              <div className="flex items-start gap-2 text-[13px] text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-xl p-3">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {analyzeState.message}
              </div>
            )}

            {analysis && verdict && action && (
              <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-b from-violet-500/10 to-zinc-950/60 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-violet-500/20 text-violet-200 border border-violet-500/30">
                      {analysis.proposal.intent}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono">proposal #{String(analysis.proposalGeneratedAt).slice(-6)}</span>
                  </div>
                  <div
                    className={`flex items-center gap-1.5 text-[11px] font-mono ${
                      analysisExpired ? 'text-rose-300' : 'text-emerald-300'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {analysisExpired ? 'expired — re-analyze' : `${expiresIn}s left`}
                  </div>
                </div>

                <div>
                  <div className="text-[15px] font-semibold text-zinc-100">{analysis.proposal.reason}</div>
                  {verdict.reportOnly ? (
                    <div className="mt-2 text-[13px] text-zinc-400">
                      Advisory only — no action proposed, nothing will be executed.
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-[13px]">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-zinc-500">Transfer</span>
                        <span className="font-semibold text-zinc-100">
                          {action.amount} {assetSymbol(action.asset)}
                        </span>
                        <ArrowRight className="w-4 h-4 text-violet-400" />
                        <span className="text-zinc-500">to</span>
                        <span className="font-mono text-violet-200">{shortenAddress(action.recipient, 8)}</span>
                        <span className="text-[11px] text-zinc-600">approved destination</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Policy evidence */}
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Policy checks (deterministic)</div>
                  {verdict.checks.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-[12px]">
                      {c.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className={c.passed ? 'text-emerald-300' : 'text-rose-300'}>{c.label}</span>
                        <span className="text-zinc-500"> — {c.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-2 text-[11px] text-zinc-500 border-t border-zinc-800 pt-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
                  <span>
                    The analysis verdict is advisory. On confirm, the app re-checks your current STRK20 state, re-runs
                    this policy against it, and only then asks your wallet to sign the private transfer.
                  </span>
                </div>

                {/* Confirm / re-analyze */}
                {!verdict.reportOnly && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => void confirm()}
                      disabled={executeState.status === 'running' || !verdict.allowed || analysisExpired}
                      className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        verdict.allowed && !analysisExpired
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-black'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {executeState.status === 'running' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Re-checking state, proving, signing…
                        </>
                      ) : verdict.allowed && !analysisExpired ? (
                        <>
                          <ShieldCheck className="w-4 h-4" /> Confirm & execute private transfer
                        </>
                      ) : analysisExpired ? (
                        'Analysis expired — re-run'
                      ) : (
                        'Blocked by policy'
                      )}
                    </button>
                    <button
                      onClick={() => setAnalyzeState({ status: 'idle' })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 text-zinc-400 text-[13px] font-semibold px-4 py-3 hover:text-zinc-200"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Re-analyze
                    </button>
                  </div>
                )}
                {!verdict.allowed && !verdict.reportOnly && (
                  <p className="text-[12px] text-rose-300">
                    One or more policy checks failed — this action cannot execute as proposed. Adjust your request and
                    re-analyze.
                  </p>
                )}
              </div>
            )}

            {/* Execution states */}
            {executeState.status === 'success' && analysis && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-2">
                <div className="flex items-center gap-2 text-[15px] font-bold text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" /> Private transfer submitted
                </div>
                <div className="text-[13px] text-emerald-100/90">
                  {formatTokenAmount(executeState.result.amountBaseUnits, assetDecimals(analysis.proposal.action.asset), 6)}{' '}
                  {assetSymbol(analysis.proposal.action.asset)} · private transfer · confirmed by your wallet.
                </div>
                {executeState.result.transactionHash && (
                  <a
                    href={`https://sepolia.voyager.online/tx/${executeState.result.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-mono text-emerald-300 underline"
                  >
                    {executeState.result.transactionHash.slice(0, 24)}… <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
            {executeState.status === 'failure' && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 space-y-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-300">
                  <XCircle className="w-4 h-4" /> {executionFailureTitle(executeState.reason)}
                </div>
                <p className="text-[12px] text-rose-200/80">{executeState.detail}</p>
                <p className="text-[11px] text-rose-300/60">
                  Nothing was executed. If your balances changed or the analysis expired, re-run the analysis.
                </p>
              </div>
            )}

            {/* Activity */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100 mb-2">
                <Activity className="w-4 h-4 text-violet-400" /> Recent treasury activity
              </div>
              {treasuryActivity.length === 0 ? (
                <div className="text-[12px] text-zinc-600">
                  No treasury transfers yet. Completed AI rebalances appear here and in Activity.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {treasuryActivity.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-200">{t.privacyDetails || 'Private transfer'}</span>
                        <span className="text-zinc-500">
                          {t.amount} {t.tokenSymbol}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-zinc-500">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            t.status === 'CONFIRMED' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {t.status}
                        </span>
                        <span className="font-mono text-zinc-600">{t.isPrivate ? '🛡 private' : 'public'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/activity" className="inline-block mt-3 text-[12px] text-violet-300 hover:text-violet-200">
                View full activity →
              </Link>
            </div>

            <p className="text-[11px] text-zinc-600">
              The copilot only ever proposes. Execution goes through your STRK20 private transfer → prover → discovery →
              your wallet signature. No autonomous execution, no arbitrary calldata.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );

  function assetSymbol(asset: string): string {
    const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(asset));
    return meta?.symbol ?? 'TOKEN';
  }

  function assetDecimals(asset: string): number {
    const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(asset));
    return meta?.decimals ?? 18;
  }

  function executionFailureTitle(reason: string): string {
    switch (reason) {
      case 'EXPIRED':
        return 'Analysis expired';
      case 'STATE_CHANGED':
        return 'Balances changed — re-analyze required';
      case 'POLICY_REJECTED':
        return 'Policy rejected against current state';
      case 'AMOUNT_INVALID':
        return 'Invalid amount';
      default:
        return 'Execution failed';
    }
  }
}