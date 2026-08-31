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
  Lock,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { ActionProposal } from '@/ai/schema';
import { PortfolioSummary, PrivateBalanceRow, buildPortfolioSummary } from '@/ai/portfolio';
import {
  PolicyVerdict,
  TreasuryPolicy,
  DEFAULT_TREASURY_POLICY,
  simulateAction,
  ScenarioSimulation,
  TREASURY_POLICY_PRESETS,
  getPolicyPreset,
  resolveUserPolicy,
  UserPolicySelection,
  DEFAULT_POLICY_PRESET_ID,
} from '@/ai/policy';
import {
  computeTreasuryHealth,
  extractRequestedLiquidityUsd,
  classifyActionability,
  blockedPolicyChecks,
  buildDiagnosis,
  liquidityRequestConflicts,
  Actionability,
} from '@/ai/health';
import { AssetPrice, resolvePortfolioPrices } from '@/ai/prices';
import { AgentPlan } from '@/ai/plan';
import { ShadowAccountCapability } from '@/ai/shadow';
import { verifyExecution, ExecutionVerification, OutcomePoint } from '@/ai/verification';
import { executeIntent, tokenSymbols, resolvePrivateTreasuryAddress, buildAnalyzeRequest, ExecutionResult } from '@/services/treasuryService';
import { strk20WalletApiService } from '@/services/strk20WalletApiService';
import { shortenAddress, formatTokenAmount } from '@/utils/formatters';

interface AnalyzeResponse {
  summary: PortfolioSummary;
  plan: AgentPlan;
  proposal: ActionProposal;
  verdict: PolicyVerdict;
  policy: TreasuryPolicy;
  shadowCapability: ShadowAccountCapability;
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

/** Tone for a visual risk bar: bad = over the cap/floor, warn = close, good = within. */
function barTone(value: number, cap: number): 'good' | 'warn' | 'bad' {
  if (value > cap) return 'bad';
  if (value >= cap * 0.9) return 'warn';
  return 'good';
}

export default function TreasuryPage() {
  const { wallet, refreshAfterMutation, transactions, recordTransaction } = useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null && privy.viewingKey !== null;

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [priceStatus, setPriceStatus] = useState<Record<string, AssetPrice>>({});
  const [loadingBalances, setLoadingBalances] = useState(true);

  // Secondary "ask" input — the product is proactive, this is optional.
  const [prompt, setPrompt] = useState('');
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>({ status: 'idle' });
  const [executeState, setExecuteState] = useState<ExecuteState>({ status: 'idle' });
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const analysisBalancesRef = useRef<PrivateBalanceRow[]>([]);
  // Refs so the mount effect never re-triggers when `privy`/`wallet` object identities churn.
  const summaryRef = useRef<PortfolioSummary | null>(null);
  const refreshBalancesRef = useRef<() => Promise<void>>(async () => {});

  // The currently displayed What-If scenario (starts from the recommendation).
  const [scenario, setScenario] = useState<ScenarioSimulation | null>(null);
  // Post-execution verification: expected (simulated) vs actual (refreshed) outcome.
  const [verification, setVerification] = useState<ExecutionVerification | null>(null);

  // User-selected treasury guardrail. The AI can NEVER modify this.
  const [guardrail, setGuardrail] = useState<UserPolicySelection>({ preset: DEFAULT_POLICY_PRESET_ID });
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState({ minLiquidityUsd: '50', maxPositionPct: '80', maxTxUsd: '150' });
  const [customError, setCustomError] = useState<string | null>(null);

  const connected = wallet.isConnected;

  // The STRK20 private treasury identity (source of every private transfer).
  const privateTreasuryAddress = resolvePrivateTreasuryAddress({
    privyConnected,
    privyAccountAddress: privy.account?.address,
    privyAddress: privy.address,
    walletAddress: wallet.address,
  });

  const refreshBalances = useCallback(async () => {
    if (!connected) return;
    try {
      const rows = await fetchRows();
      const symbols = tokenSymbols(rows);
      const bySymbol = await resolvePortfolioPrices(symbols).catch(() => ({} as Record<string, AssetPrice>));
      const prices: Record<string, AssetPrice> = {};
      for (const r of rows) {
        const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(r.token));
        if (meta && bySymbol[meta.symbol]) prices[r.token.toLowerCase()] = bySymbol[meta.symbol];
      }
      setPriceStatus(prices);
      const built = buildPortfolioSummary(rows, prices);
      summaryRef.current = built;
      setSummary(built);
    } catch {
      // wallet/STRK20 read failed — keep prior state
    }
  }, [connected, privyConnected, privy, wallet]);

  // Keep the ref pointing at the latest refresh closure so the connect effect below is stable.
  useEffect(() => {
    refreshBalancesRef.current = refreshBalances;
  });

  const fetchRows = useCallback(async (): Promise<PrivateBalanceRow[]> => {
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
  }, [privyConnected, privy, wallet]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    // Only show the loading placeholder when there is nothing on screen yet — an in-place
    // refresh must never blank the current balance. Run once per connect (the refresh closure
    // is read from a ref so unstable `privy`/`wallet` identities cannot re-trigger this effect).
    if (!summaryRef.current) setLoadingBalances(true);
    void refreshBalancesRef.current().finally(() => {
      if (active) setLoadingBalances(false);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

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

  const changeGuardrail = (next: UserPolicySelection) => {
    setGuardrail(next);
    // A different guardrail invalidates the previous analysis + scenario.
    setAnalyzeState({ status: 'idle' });
    setExecuteState({ status: 'idle' });
    setScenario(null);
    setVerification(null);
  };

  const applyCustomGuardrail = () => {
    const minLiquidityUsd = Number(customDraft.minLiquidityUsd);
    const maxPositionPct = Number(customDraft.maxPositionPct);
    const maxTxUsd = Number(customDraft.maxTxUsd);
    const resolved = resolveUserPolicy({
      preset: 'custom',
      custom: { minLiquidityUsd, maxPositionPct, maxTxUsd },
    });
    if (!resolved.ok) {
      setCustomError(resolved.error);
      return;
    }
    setCustomError(null);
    changeGuardrail({ preset: 'custom', custom: { minLiquidityUsd, maxPositionPct, maxTxUsd } });
    setCustomOpen(false);
  };

  const analyze = async () => {
    if (!connected || !prompt.trim() || analyzeState.status === 'loading') return;
    setExecuteState({ status: 'idle' });
    setAnalyzeState({ status: 'loading' });
    setScenario(null);
    setVerification(null);
    try {
      const rows = await fetchRows();
      analysisBalancesRef.current = rows;

      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildAnalyzeRequest({
            prompt,
            balances: rows,
            userAddress: wallet.address ?? '',
            privateTreasuryAddress,
            policy: guardrail,
            recentActivity: treasuryActivity,
          }),
        ),
      });
      const json = (await res.json()) as AnalyzeResponse & { error?: string };
      if (!res.ok) {
        setAnalyzeState({ status: 'error', message: json.error ?? 'Analysis failed. Please try again.' });
        return;
      }
      setAnalyzeState({ status: 'done', analysis: json });
      // Seed the What-If with the plan's canonical expected simulation (single source of truth).
      if (json.plan.executionIntent) {
        setScenario(json.plan.executionIntent.expectedSimulation);
      }
    } catch (e) {
      setAnalyzeState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Analysis failed. Please try again.',
      });
    }
  };

  const confirm = async () => {
    if (analyzeState.status !== 'done' || executeState.status === 'running') return;
    const { plan, policy, proposalExpiresAt } = analyzeState.analysis;
    const intent = plan.executionIntent;
    if (!intent) return; // advisory plan — nothing to execute
    setExecuteState({ status: 'running' });
    try {
      // 1. Re-fetch CURRENT wallet/STRK20 state.
      const currentBalances = await fetchRows();

      // 2. Execute ONLY through the ExecutionRouter using the plan's canonical intent.
      const executeTransfer = async (opts: { amountBase: bigint; token: string; recipient: string }) => {
        if (privyConnected) {
          const res = await privy.transfer(opts.token, opts.amountBase, opts.recipient);
          return { transactionHash: res.transactionHash };
        }
        return strk20WalletApiService.privateTransfer(wallet, opts.token, opts.amountBase, opts.recipient);
      };

      const result = await executeIntent({
        intent,
        expiresAt: proposalExpiresAt,
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
      const tokenSymbol = assetSymbol(intent.asset);
      const decimals = assetDecimals(intent.asset);
      recordTransaction({
        id: `treasury-${Date.now()}`,
        type: 'PRIVATE_TRANSFER',
        txHash: result.transactionHash,
        timestamp: Date.now(),
        tokenSymbol,
        amount: formatTokenAmount(result.amountBaseUnits, decimals, 6),
        recipient: intent.recipient,
        status: 'CONFIRMED',
        isPrivate: true,
        privacyDetails: 'AI Treasury Rebalance',
      });
      setExecuteState({ status: 'success', result });
      await refreshAfterMutation();
      // 4. Verify against the SAME plan's expected simulation (returned by the router).
      await refreshAndVerify(result.expectedSimulation.after);
    } catch (e) {
      setExecuteState({
        status: 'failure',
        reason: 'EXECUTION_FAILED',
        detail: e instanceof Error ? e.message : 'Execution failed.',
      });
    }
  };

  const refreshAndVerify = useCallback(
    async (expected: OutcomePoint | null) => {
      try {
        const fresh = await fetchRows();
        const symbols = tokenSymbols(fresh);
        const bySymbol = await resolvePortfolioPrices(symbols).catch(() => ({} as Record<string, AssetPrice>));
        const prices: Record<string, AssetPrice> = {};
        for (const r of fresh) {
          const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(r.token));
          if (meta && bySymbol[meta.symbol]) prices[r.token.toLowerCase()] = bySymbol[meta.symbol];
        }
        setPriceStatus(prices);
        const freshSummary = buildPortfolioSummary(fresh, prices);
        summaryRef.current = freshSummary;
        setSummary(freshSummary);
        if (expected) {
          setVerification(verifyExecution(expected, freshSummary));
        }
      } catch {
        // wallet/STRK20 read failed — verification stays null; prior summary remains.
      }
    },
    [fetchRows],
  );

  // A deterministic "what if" for a target USD move of the recommended asset.
  const scenarioForUsd = useCallback(
    (targetUsd: number): ScenarioSimulation | null => {
      if (analyzeState.status !== 'done') return null;
      const { analysis } = analyzeState;
      const intent = analysis.plan.executionIntent;
      if (!intent) return null;
      const asset = intent.asset;
      const pos = analysis.summary.positions.find((p) => canonicalToken(p.token) === canonicalToken(asset));
      if (!pos || pos.priceUsd <= 0) return null;
      const amount = Math.min(targetUsd / pos.priceUsd, pos.balanceHuman);
      if (amount <= 0) return null;
      return simulateAction(analysis.summary, analysis.policy, {
        asset,
        amount: amount.toFixed(Math.min(6, pos.decimals)),
      });
    },
    [analyzeState],
  );

  const treasuryActivity = useMemo(
    () =>
      transactions
        .filter((t) => t.type === 'PRIVATE_TRANSFER')
        .slice(0, 6)
        .map((t) => ({ ...t })),
    [transactions],
  );

  // ---- Derived view state -------------------------------------------------

  const analysis = analyzeState.status === 'done' ? analyzeState.analysis : null;
  const verdict = analysis?.verdict ?? null;
  const intent = analysis?.plan.executionIntent ?? null;
  const action = intent
    ? { type: 'private_transfer' as const, asset: intent.asset, amount: intent.amountHuman, recipient: intent.recipient }
    : null;
  const analysisExpired = expiresIn !== null && expiresIn <= 0;

  const guardrailPolicy = useMemo<TreasuryPolicy>(() => {
    const r = resolveUserPolicy(guardrail);
    return { ...DEFAULT_TREASURY_POLICY, ...(r.ok ? r.values : {}) };
  }, [guardrail]);
  const activePolicy = analysis?.policy ?? guardrailPolicy;
  const activePreset = getPolicyPreset(guardrail.preset);

  const health = summary ? computeTreasuryHealth(summary, activePolicy) : null;
  const diagnosis = summary && health ? buildDiagnosis(health, summary) : null;
  const requestedLiquidityUsd = extractRequestedLiquidityUsd(prompt);
  const requestConflict = liquidityRequestConflicts(requestedLiquidityUsd, activePolicy);
  const actionability: Actionability | null = analysis ? classifyActionability(analysis.proposal, analysis.verdict) : null;
  const failedChecks = verdict ? blockedPolicyChecks(verdict) : [];

  // The canonical expected outcome lives on the plan's ExecutionIntent — the same object used for
  // display, execution, and post-execution verification. There is no separate reconstruction.
  const recommendedSim: ScenarioSimulation | null = intent?.expectedSimulation ?? null;
  const displaySim = scenario ?? recommendedSim;

  const noDestination = !!analysis && analysis.policy.allowedDestinations.length === 0;
  const executionReady = actionability === 'EXECUTABLE' && !analysisExpired && !noDestination && !!intent;

  const insight = analysis?.proposal.insight;

  // Proactive headline (no LLM) so the page is useful on load.
  const proactiveHeadline = useMemo(() => {
    if (!health) return null;
    if (!health.aboveLiquidityTarget) {
      return `Your liquidity is below your ${fmtUsd(health.liquidityTargetUsd)} guardrail.`;
    }
    if (health.concentrationRisk === 'high') {
      return `Your treasury is concentrated in ${summary?.topAsset?.symbol ?? 'one asset'}.`;
    }
    return 'Your treasury is within your current guardrails.';
  }, [health, summary]);

  return (
    <AppShell>
      <div className="product-page">
        {/* A. Header */}
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / PRIVATE TREASURY</div>
            <h1 className="product-page-title">Private Treasury</h1>
            <p className="product-page-description">
              Your STRK20 private portfolio, diagnosed by Hamster behind a{' '}
              <span style={{ color: 'var(--app-accent)' }}>deterministic safety policy</span> — you confirm before anything moves.
            </p>
          </div>
          <div
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px]"
            style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
          >
            <Shield className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
            STRK20 Private Identity
            <span className="font-mono" style={{ color: 'var(--app-text-secondary)' }}>
              {privateTreasuryAddress ? shortenAddress(privateTreasuryAddress, 6) : '—'}
            </span>
          </div>
        </div>

        {!connected ? (
          <ConnectGate />
        ) : (
          <>
            {/* A. Total value */}
            <div className="product-summary">
              <div className="product-summary-top">
                <div>
                  <div className="product-summary-label">Private treasury value</div>
                  <div className="product-summary-value" style={{ marginTop: '0.35rem' }}>
                    {loadingBalances ? '…' : summary ? fmtUsd(summary.totalUsd) : '—'}
                  </div>
                  <div className="product-summary-note" style={{ marginTop: '0.5rem' }}>
                    <Lock className="inline w-3.5 h-3.5" style={{ marginRight: '0.3rem', verticalAlign: '-0.2rem', color: 'var(--app-accent)' }} />
                    {Object.values(priceStatus).some((p) => p.source === 'static' && p.priceUsd > 0)
                      ? 'USD values include fallback prices (advisory)'
                      : 'USD values from live market feed'}
                  </div>
                </div>
              </div>
              <div className="product-summary-split">
                <div>
                  <div className="product-split-label">
                    <span className="is-private" /> Liquid
                  </div>
                  <div className="product-split-value">
                    {loadingBalances ? '…' : summary ? fmtUsd(summary.liquidityUsd) : '—'}
                  </div>
                  <div className="product-summary-note">
                    {summary ? `${summary.liquidPct.toFixed(0)}% of treasury · floor ${fmtUsd(activePolicy.minLiquidityUsd)}` : 'usable toward your liquidity guardrail'}
                  </div>
                </div>
                <div>
                  <div className="product-split-label">
                    <span /> Top position
                  </div>
                  <div className="product-split-value">
                    {loadingBalances || !summary?.topAsset ? '—' : `${summary.topAsset.symbol} · ${summary.topAsset.pct.toFixed(0)}%`}
                  </div>
                  <div className="product-summary-note">cap {activePolicy.maxPositionPct >= 100 ? 'off' : `${activePolicy.maxPositionPct}%`}</div>
                </div>
              </div>
            </div>

            {/* B. Portfolio + guardrail */}
            <div className="product-card" style={{ padding: '1.4rem 1.5rem', display: 'grid', gap: '1.25rem' }}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="product-summary-label">Portfolio</div>
                  <div style={{ color: 'var(--app-text)', fontSize: '0.95rem', fontWeight: 600, marginTop: '0.2rem' }}>
                    {loadingBalances ? 'Reading balances…' : !summary || summary.positions.length === 0 ? 'No private balances yet' : `${summary.positions.length} private position${summary.positions.length === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div className="product-mode-selector inline-flex rounded-xl border p-1" role="group" aria-label="Treasury guardrail">
                  {TREASURY_POLICY_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => changeGuardrail({ preset: p.id })}
                      className={`px-3 py-1.5 text-[12px] font-semibold ${
                        guardrail.preset === p.id ? 'product-tab-active' : 'product-tab-idle'
                      }`}
                      style={{ color: guardrail.preset === p.id ? 'var(--app-text)' : 'var(--app-text-secondary)' }}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomOpen((o) => !o);
                      if (guardrail.preset !== 'custom') {
                        setCustomDraft({
                          minLiquidityUsd: String(guardrailPolicy.minLiquidityUsd),
                          maxPositionPct: String(guardrailPolicy.maxPositionPct),
                          maxTxUsd: String(guardrailPolicy.maxTxUsd),
                        });
                      }
                    }}
                    className={`px-3 py-1.5 text-[12px] font-semibold ${
                      guardrail.preset === 'custom' ? 'product-tab-active' : 'product-tab-idle'
                    }`}
                    style={{ color: guardrail.preset === 'custom' ? 'var(--app-text)' : 'var(--app-text-secondary)' }}
                  >
                    Custom
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--app-text-muted)' }}>
                <span>Guardrail · {activePreset ? `${activePreset.label} — ${activePreset.description}` : 'custom limits'}.</span>
                <span>You control it. The AI can never change it.</span>
              </div>

              {customOpen && (
                <div className="grid sm:grid-cols-3 gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface-raised)' }}>
                  {(
                    [
                      ['minLiquidityUsd', 'Min liquid $'],
                      ['maxPositionPct', 'Position cap %'],
                      ['maxTxUsd', 'Max per action $'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>
                      {label}
                      <input
                        type="number"
                        inputMode="decimal"
                        value={customDraft[key]}
                        onChange={(e) => {
                          setCustomDraft((d) => ({ ...d, [key]: e.target.value }));
                          setCustomError(null);
                        }}
                        className="mt-1 w-full rounded-lg border px-2 py-1.5 text-[13px] outline-none"
                        style={{ borderColor: 'var(--app-border-strong)', background: 'var(--app-surface)', color: 'var(--app-text)' }}
                      />
                    </label>
                  ))}
                  <div className="flex items-end gap-2 sm:col-span-3">
                    <button
                      type="button"
                      onClick={applyCustomGuardrail}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white"
                      style={{ background: 'var(--app-accent)' }}
                    >
                      Apply custom guardrail
                    </button>
                    <span className="text-[10px]" style={{ color: 'var(--app-text-faint)' }}>
                      Validated server-side on every analysis · floor 0–$1M · cap 1–100% · tx $1–$10M
                    </span>
                  </div>
                  {customError && (
                    <div className="sm:col-span-3 text-[11px]" style={{ color: 'var(--app-danger)' }}>
                      {customError} — nothing was changed.
                    </div>
                  )}
                </div>
              )}

              {/* Asset allocation */}
              {summary && summary.positions.length > 0 ? (
                <div style={{ display: 'grid', gap: '1.1rem' }}>
                  <div>
                    <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--app-text-faint) 22%, transparent)' }}>
                      {summary.positions.map((p) => (
                        <div
                          key={p.token}
                          title={`${p.symbol} ${p.pct.toFixed(1)}%`}
                          style={{
                            width: `${p.pct}%`,
                            background: p.symbol === 'STRK' ? 'var(--app-accent)' : p.symbol === 'USDC' ? '#2f9e7b' : '#5b7cc9',
                            transition: 'width 500ms ease',
                          }}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {summary.positions.map((p) => (
                        <div key={p.token} className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--app-text-secondary)' }}>
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.symbol === 'STRK' ? 'var(--app-accent)' : p.symbol === 'USDC' ? '#2f9e7b' : '#5b7cc9' }} />
                          <span className="font-semibold" style={{ color: 'var(--app-text)' }}>{p.symbol}</span>
                          <span className="font-mono">{p.balanceHuman.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                          <span>{fmtUsd(p.usdValue)}</span>
                          <span style={{ color: 'var(--app-text-muted)' }}>{p.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Risk bars */}
                  <div style={{ display: 'grid', gap: '0.85rem' }}>
                    {health && (
                      <>
                        <div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span style={{ color: 'var(--app-text-muted)' }}>{summary.topAsset?.symbol ?? 'Top'} exposure</span>
                            <span className="font-mono" style={{ color: 'var(--app-text-secondary)' }}>
                              {health.concentrationPct.toFixed(0)}% · target {activePolicy.maxPositionPct >= 100 ? 'off' : `${activePolicy.maxPositionPct}%`}
                            </span>
                          </div>
                          <RiskBar
                            value={health.concentrationPct}
                            target={activePolicy.maxPositionPct >= 100 ? 100 : activePolicy.maxPositionPct}
                            tone={barTone(health.concentrationPct, activePolicy.maxPositionPct)}
                            showMarker={activePolicy.maxPositionPct < 100}
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span style={{ color: 'var(--app-text-muted)' }}>Liquidity</span>
                            <span className="font-mono" style={{ color: 'var(--app-text-secondary)' }}>
                              {fmtUsd(health.liquidityUsd)} · floor {fmtUsd(activePolicy.minLiquidityUsd)}
                            </span>
                          </div>
                          <RiskBar value={health.liquidityUsd} target={activePolicy.minLiquidityUsd} tone={barTone(health.liquidityUsd, activePolicy.minLiquidityUsd)} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-[12px]" style={{ color: 'var(--app-text-muted)' }}>
                  {loadingBalances ? 'Reading STRK20 balances…' : 'No private balances yet. Shield funds in your wallet, then ask Hamster.'}
                </div>
              )}
            </div>

            {/* C + D. Hamster Insight + What-If */}
            <div
              className="product-card"
              style={{
                padding: '1.5rem',
                display: 'grid',
                gap: '1.25rem',
                borderColor: 'color-mix(in srgb, var(--app-accent) 34%, transparent)',
              }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full" style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}>
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <span className="text-[14px] font-bold" style={{ color: 'var(--app-text)' }}>
                    Hamster Insight
                  </span>
                  {actionability && (
                    <StatusBadge actionability={actionability} analysisExpired={analysisExpired} />
                  )}
                </div>
                {analysis && (
                  <div className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: analysisExpired ? 'var(--app-danger)' : 'var(--app-success)' }}>
                    <Clock className="w-3.5 h-3.5" />
                    {analysisExpired ? 'expired — re-analyze' : `${expiresIn}s left`}
                  </div>
                )}
              </div>

              {analyzeState.status === 'loading' ? (
                <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--app-accent)' }} /> Hamster is reading your treasury…
                </div>
              ) : analyzeState.status === 'error' ? (
                <div className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--app-danger)' }}>
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {analyzeState.message}
                </div>
              ) : analysis ? (
                <AnalysisInsight
                  analysis={analysis}
                  actionability={actionability}
                  diagnosis={diagnosis}
                  failedChecks={failedChecks}
                  displaySim={displaySim}
                  noDestination={noDestination}
                  onTryUsd={(usd) => {
                    const sim = scenarioForUsd(usd);
                    if (sim) setScenario(sim);
                  }}
                  requestConflict={requestConflict}
                  requestedLiquidityUsd={requestedLiquidityUsd}
                />
              ) : health && diagnosis && proactiveHeadline ? (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div>
                    <div className="text-[16px] font-bold" style={{ color: 'var(--app-text)' }}>
                      {proactiveHeadline}
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                      <div>{diagnosis.concentrationLine}</div>
                      <div>{diagnosis.liquidityLine}</div>
                    </div>
                    <div className="mt-2 text-[12px]" style={{ color: 'var(--app-accent)' }}>
                      Next step: {diagnosis.bestNextStep}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                  {loadingBalances ? 'Loading…' : 'Shield funds in your wallet, then ask Hamster to plan a move.'}
                </div>
              )}

              {/* Secondary ask input */}
              <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface-raised)' }}>
                <div className="flex items-center gap-2">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={1}
                    placeholder="Ask Hamster (optional) — e.g. Make my treasury safer."
                    className="flex-1 min-w-0 resize-none bg-transparent px-2 py-1.5 text-[13px] outline-none"
                    style={{ color: 'var(--app-text)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setPrompt('Make my treasury safer.')}
                    className="shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold"
                    style={{ borderColor: 'color-mix(in srgb, var(--app-accent) 38%, transparent)', color: 'var(--app-accent)' }}
                  >
                    <Sparkles className="inline h-3 w-3" style={{ marginRight: '0.25rem', verticalAlign: '-0.1rem' }} />
                    Safer
                  </button>
                  <button
                    type="button"
                    onClick={() => void analyze()}
                    disabled={analyzeState.status === 'loading' || !prompt.trim()}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                    style={{ background: 'var(--app-accent)' }}
                  >
                    {analyzeState.status === 'loading' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing…
                      </>
                    ) : (
                      <>
                        Diagnose <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* E. Action */}
            {analysis && action && (
              <div className="product-card" style={{ padding: '1.4rem 1.5rem', display: 'grid', gap: '1rem' }}>
                {executionReady ? (
                  <>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                        <span className="font-bold" style={{ color: 'var(--app-text)' }}>
                          {action.amount} {assetSymbol(action.asset)}
                        </span>{' '}
                        → approved private destination{' '}
                        <span className="font-mono" style={{ color: 'var(--app-accent)' }}>
                          {shortenAddress(action.recipient, 8)}
                        </span>
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>
                        Re-checks your current state, re-runs your guardrail with fresh prices, then asks your wallet to sign.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void confirm()}
                      disabled={executeState.status === 'running'}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-transform hover:scale-[1.01] disabled:opacity-50"
                      style={{ background: 'var(--app-accent)', boxShadow: '0 10px 26px color-mix(in srgb, var(--app-accent) 26%, transparent)' }}
                    >
                      {executeState.status === 'running' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Re-checking state, re-running guardrail, signing…
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" /> Review private transfer
                        </>
                      )}
                    </button>
                  </>
                ) : noDestination ? (
                  <div className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--app-warning)' }} />
                    <span>
                      <span className="font-semibold" style={{ color: 'var(--app-text)' }}>Analysis only</span> — add an approved private destination to enable execution.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--app-danger)' }} />
                    <div>
                      <span className="font-semibold" style={{ color: 'var(--app-text)' }}>
                        Not executable under your guardrail.
                      </span>
                      {failedChecks.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[12px]" style={{ color: 'var(--app-text-muted)' }}>
                          {failedChecks.slice(0, 3).map((c) => (
                            <li key={c.id}>
                              ✗ {c.label} — {c.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-1.5 text-[11px]" style={{ color: 'var(--app-text-muted)' }}>
                        Adjust the amount, relax your guardrail, or re-analyze. Nothing was executed.
                      </div>
                    </div>
                  </div>
                )}
                {analysis && (
                  <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--app-border)' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setAnalyzeState({ status: 'idle' });
                        setScenario(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
                      style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-secondary)' }}
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> New analysis
                    </button>
                    <span className="text-[11px]" style={{ color: 'var(--app-text-faint)' }}>
                      Every execution re-runs your selected guardrail against fresh state. The AI only proposes.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Execution states */}
            {executeState.status === 'success' && analysis && (
              <div className="product-card" style={{ padding: '1.25rem 1.5rem', borderColor: 'color-mix(in srgb, var(--app-success) 46%, transparent)', display: 'grid', gap: '0.4rem' }}>
                <div className="flex items-center gap-2 text-[14px] font-bold" style={{ color: 'var(--app-success)' }}>
                  <CheckCircle2 className="w-4 h-4" /> Private transfer submitted
                </div>
                <div className="text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>
                  {intent ? `${formatTokenAmount(executeState.result.amountBaseUnits, assetDecimals(intent.asset), 6)} ${assetSymbol(intent.asset)} · confirmed by your wallet.` : 'Confirmed by your wallet.'}
                </div>
                {executeState.result.transactionHash && (
                  <a
                    href={`https://sepolia.voyager.online/tx/${executeState.result.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-mono underline"
                    style={{ color: 'var(--app-success)' }}
                  >
                    {executeState.result.transactionHash.slice(0, 24)}… <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
            {verification && executeState.status === 'success' && analysis && (
              <div className="product-card" style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '0.6rem' }}>
                <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--app-text)' }}>
                  <CheckCircle2 className="w-4 h-4" style={{ color: verification.matches ? 'var(--app-success)' : 'var(--app-warning)' }} />
                  Outcome verified
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={
                      verification.matches
                        ? { background: 'color-mix(in srgb, var(--app-success) 14%, transparent)', color: 'var(--app-success)' }
                        : { background: 'color-mix(in srgb, var(--app-warning) 14%, transparent)', color: 'var(--app-warning)' }
                    }
                  >
                    {verification.matches ? 'matches' : 'deviation'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[12px]">
                  <MetricLine label="Concentration expected" value={`${verification.expected.concentrationPct.toFixed(0)}%`} />
                  <MetricLine label="Concentration actual" value={`${verification.actual.concentrationPct.toFixed(0)}%`} />
                  <MetricLine label="Liquidity" value={fmtUsd(verification.actual.liquidityUsd)} />
                </div>
                <div className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>
                  {verification.note} Within {verification.tolerancePct}% tolerance.
                </div>
              </div>
            )}
            {executeState.status === 'failure' && (
              <div className="product-card" style={{ padding: '1.25rem 1.5rem', borderColor: 'color-mix(in srgb, var(--app-danger) 46%, transparent)', display: 'grid', gap: '0.3rem' }}>
                <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--app-danger)' }}>
                  <XCircle className="w-4 h-4" /> {executionFailureTitle(executeState.reason)}
                </div>
                <p className="text-[12px]" style={{ color: 'var(--app-text-secondary)' }}>{executeState.detail}</p>
                <p className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>
                  Nothing was executed. If your balances changed or the analysis expired, re-run the analysis.
                </p>
              </div>
            )}

            {/* F. Activity */}
            <div className="product-card" style={{ padding: '1.25rem 1.5rem' }}>
              <div className="flex items-center gap-2 mb-2 text-[13px] font-semibold" style={{ color: 'var(--app-text)' }}>
                <Activity className="w-4 h-4" style={{ color: 'var(--app-accent)' }} /> Recent treasury activity
              </div>
              {treasuryActivity.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--app-text-muted)' }}>
                  No treasury transfers yet. Completed private transfers appear here and in Activity.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {treasuryActivity.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: 'var(--app-text)' }}>{t.privacyDetails || 'Private transfer'}</span>
                        <span style={{ color: 'var(--app-text-muted)' }}>
                          {t.amount} {t.tokenSymbol}
                        </span>
                      </div>
                      <div className="flex items-center gap-2" style={{ color: 'var(--app-text-muted)' }}>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px]"
                          style={
                            t.status === 'CONFIRMED'
                              ? { background: 'color-mix(in srgb, var(--app-success) 16%, transparent)', color: 'var(--app-success)' }
                              : { background: 'color-mix(in srgb, var(--app-warning) 16%, transparent)', color: 'var(--app-warning)' }
                          }
                        >
                          {t.status}
                        </span>
                        <span className="font-mono">{t.isPrivate ? 'private' : 'public'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/activity" className="inline-block mt-3 text-[12px]" style={{ color: 'var(--app-accent)' }}>
                View full activity →
              </Link>
            </div>
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
      case 'SHADOW_UNAVAILABLE':
        return 'Shadow Account execution is not available';
      default:
        return 'Execution failed';
    }
  }
}

function RiskBar({ value, target, tone, showMarker = true }: { value: number; target: number; tone: 'good' | 'warn' | 'bad'; showMarker?: boolean }) {
  // The bar's full width represents `target × 1.5`, so the target sits at ⅔ width — a value
  // over target visibly overruns the marker while a comfortable value stays well under.
  const full = target > 0 ? target * 1.5 : value;
  const pct = Math.max(0, Math.min(100, full > 0 ? (value / full) * 100 : 0));
  const markerPct = target > 0 ? (target / full) * 100 : 0;
  const color =
    tone === 'bad' ? 'var(--app-danger)' : tone === 'warn' ? 'var(--app-warning)' : 'var(--app-success)';
  return (
    <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--app-text-faint) 22%, transparent)' }}>
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: color }} />
      {showMarker && target > 0 && (
        <div
          className="absolute inset-y-0"
          style={{ left: `${markerPct}%`, width: 2, background: 'color-mix(in srgb, var(--app-text) 55%, transparent)' }}
        />
      )}
    </div>
  );
}

function StatusBadge({ actionability, analysisExpired }: { actionability: Actionability; analysisExpired: boolean }) {
  const color =
    actionability === 'EXECUTABLE'
      ? 'var(--app-success)'
      : actionability === 'BLOCKED'
        ? 'var(--app-danger)'
        : 'var(--app-text-muted)';
  const bg =
    actionability === 'EXECUTABLE'
      ? 'color-mix(in srgb, var(--app-success) 14%, transparent)'
      : actionability === 'BLOCKED'
        ? 'color-mix(in srgb, var(--app-danger) 14%, transparent)'
        : 'color-mix(in srgb, var(--app-text-muted) 14%, transparent)';
  const label =
    analysisExpired ? 'EXPIRED' : actionability === 'EXECUTABLE' ? 'EXECUTABLE' : actionability === 'BLOCKED' ? 'BLOCKED' : 'ADVISORY';
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: bg, color }}>
      {label}
    </span>
  );
}

function AnalysisInsight({
  analysis,
  actionability,
  diagnosis,
  failedChecks,
  displaySim,
  noDestination,
  onTryUsd,
  requestConflict,
  requestedLiquidityUsd,
}: {
  analysis: AnalyzeResponse;
  actionability: Actionability | null;
  diagnosis: ReturnType<typeof buildDiagnosis> | null;
  failedChecks: { id: string; label: string; detail: string }[];
  displaySim: ScenarioSimulation | null;
  noDestination: boolean;
  onTryUsd: (usd: number) => void;
  requestConflict: boolean;
  requestedLiquidityUsd: number | null;
}) {
  const { plan } = analysis;
  const intent = plan.executionIntent;
  const selected = plan.selectedScenarioId ? plan.scenarios.find((s) => s.id === plan.selectedScenarioId) ?? null : null;
  const symbol = intent ? assetSymbolFor(intent.asset) : '';
  const headline = plan.observations[0] ?? diagnosis?.concentrationLine ?? 'Your treasury needs attention.';
  const recommendation = intent
    ? `Move ${intent.amountHuman} ${assetSymbolFor(intent.asset)} to your approved private reserve.`
    : 'No action is required right now.';
  const outcome =
    plan.expectedOutcome ||
    (actionability === 'EXECUTABLE' ? 'Liquidity stays above your guardrail.' : 'The plan is not executable as proposed.');

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {/* Diagnosis */}
      <div>
        <div className="text-[16px] font-bold" style={{ color: 'var(--app-text)' }}>
          {headline}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wide" style={{ color: plan.policyStatus === 'PASS' ? 'var(--app-success)' : plan.policyStatus === 'FAIL' ? 'var(--app-danger)' : 'var(--app-text-muted)' }}>
            policy {plan.policyStatus}
          </span>
          {!analysis.shadowCapability.enabled && (
            <span className="text-[11px] font-mono" style={{ color: 'var(--app-text-faint)' }}>
              shadow accounts · off
            </span>
          )}
        </div>
        {requestConflict && requestedLiquidityUsd !== null && (
          <div className="mt-1 text-[12px]" style={{ color: 'var(--app-warning)' }}>
            Your ${requestedLiquidityUsd} target is below your active ${analysis.policy.minLiquidityUsd} guardrail, so Hamster won't move funds below it.
          </div>
        )}
      </div>

      {/* Agent observations */}
      {plan.observations.length > 0 && (
        <div className="text-[12px]" style={{ color: 'var(--app-text-secondary)' }}>
          {plan.observations.slice(0, 2).map((o, i) => (
            <div key={i}>• {o}</div>
          ))}
        </div>
      )}

      {/* Tested scenarios (deterministic numbers) */}
      {plan.scenarios.length > 0 && (
        <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface-raised)' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-text-muted)' }}>
            {plan.selectedScenarioId ? `Hamster tested ${plan.scenarios.length} moves and picked one` : `Hamster tested ${plan.scenarios.length} moves`}
          </div>
          <div className="mt-2 space-y-1.5">
            {plan.scenarios.map((sc) => {
              const isSelected = selected !== null && sc.id === selected.id;
              return (
                <div
                  key={sc.id}
                  className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]"
                  style={
                    isSelected
                      ? { borderColor: 'color-mix(in srgb, var(--app-accent) 45%, transparent)', background: 'var(--app-accent-soft)' }
                      : { borderColor: 'var(--app-border)' }
                  }
                >
                  <span className="font-semibold" style={{ color: 'var(--app-text)' }}>
                    {sc.label}
                    {isSelected && <span className="ml-1.5 text-[10px] font-mono" style={{ color: 'var(--app-accent)' }}>selected</span>}
                  </span>
                  <span className="font-mono" style={{ color: 'var(--app-text-secondary)' }}>
                    {assetSymbolFor(sc.action.asset)} {sc.simulation.before.concentrationPct.toFixed(0)}% → {sc.simulation.after.concentrationPct.toFixed(0)}%
                  </span>
                  <span className="font-mono" style={{ color: sc.policyCompliant ? 'var(--app-success)' : 'var(--app-danger)' }}>
                    {sc.policyCompliant ? '✓ policy' : '✗ policy'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendation */}
      <div className="rounded-xl border p-3.5" style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface-raised)' }}>
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-text-muted)' }}>
          Hamster recommends
        </div>
        <div className="mt-1 text-[15px] font-bold" style={{ color: 'var(--app-text)' }}>
          {recommendation}
        </div>
        <div className="mt-1.5 space-y-1 text-[12px]" style={{ color: 'var(--app-text-secondary)' }}>
          <div>
            <span className="font-semibold" style={{ color: 'var(--app-text-muted)' }}>Expected · </span>
            {outcome}
          </div>
          {plan.risks.length > 0 && (
            <div>
              <span className="font-semibold" style={{ color: 'var(--app-text-muted)' }}>Risks · </span>
              {plan.risks.slice(0, 2).join(' ')}
            </div>
          )}
        </div>
      </div>

      {/* What-If: BEFORE → AFTER */}
      {intent && displaySim?.ok && (
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--app-text-muted)' }}>
            <span>What happens if I do it</span>
            {displaySim.estimated && (
              <span className="font-semibold normal-case tracking-normal" style={{ color: 'var(--app-warning)' }}>
                <AlertTriangle className="inline h-3 w-3" style={{ marginRight: '0.2rem', verticalAlign: '-0.15rem' }} />
                estimated prices
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--app-border)' }}>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--app-text-muted)' }}>Before</div>
              <MetricLine label={`${symbol} exposure`} value={`${displaySim.before.concentrationPct.toFixed(0)}%`} />
              <MetricLine label="Liquidity" value={fmtUsd(displaySim.before.liquidityUsd)} />
              <MetricLine label="Policy" value={beforePolicyPasses(analysis, displaySim) ? '✓' : '✗'} />
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--app-accent) 40%, transparent)', background: 'color-mix(in srgb, var(--app-accent) 5%, transparent)' }}>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--app-accent)' }}>After</div>
              <MetricLine label={`${symbol} exposure`} value={`${displaySim.after.concentrationPct.toFixed(0)}%`} />
              <MetricLine label="Liquidity" value={fmtUsd(displaySim.after.liquidityUsd)} />
              <MetricLine label="Policy" value={displaySim.verdict.allowed ? '✓' : '✗'} />
            </div>
          </div>

          {/* Result line + alternative scenarios */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div
              className="text-[12px] font-bold"
              style={{ color: displaySim.verdict.allowed ? 'var(--app-success)' : 'var(--app-warning)' }}
            >
              {noDestination
                ? 'Analysis only — no approved destination yet.'
                : displaySim.verdict.allowed
                  ? 'Executable under your current guardrail.'
                  : failedChecks.length > 0
                    ? `✗ ${failedChecks[0].label}`
                    : '✗ Not executable as proposed.'}
            </div>
            {!noDestination && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px]" style={{ color: 'var(--app-text-muted)' }}>Try:</span>
                {[25, 50, 100].map((usd) => (
                  <button
                    key={usd}
                    type="button"
                    onClick={() => onTryUsd(usd)}
                    className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                    style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-secondary)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--app-accent)';
                      e.currentTarget.style.color = 'var(--app-accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--app-border)';
                      e.currentTarget.style.color = 'var(--app-text-secondary)';
                    }}
                  >
                    ${usd}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Advisory-only note */}
      {actionability === 'ADVISORY' && (
        <div className="text-[12px]" style={{ color: 'var(--app-text-muted)' }}>
          Analysis only — Hamster found no state-changing action under your current guardrail.
        </div>
      )}
    </div>
  );

  function beforePolicyPasses(analysis: AnalyzeResponse, sim: ScenarioSimulation): boolean {
    const top = sim.before.concentrationPct;
    const liq = sim.before.liquidityUsd;
    const pol = analysis.policy;
    return top <= pol.maxPositionPct && liq >= pol.minLiquidityUsd;
  }

  function assetSymbolFor(asset: string): string {
    return SEPOLIA_TOKENS.find((t) => t.address.toLowerCase() === asset.toLowerCase())?.symbol ?? 'TOKEN';
  }
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between text-[12px]">
      <span style={{ color: 'var(--app-text-muted)' }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: 'var(--app-text)' }}>{value}</span>
    </div>
  );
}