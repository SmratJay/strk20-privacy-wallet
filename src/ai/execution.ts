/**
 * @file src/ai/execution.ts
 * @description ExecutionRouter — the ONE execution layer. It consumes a validated ExecutionIntent
 * (the execution portion of an AgentPlan) plus fresh state, and runs the existing STRK20
 * private-transfer path.
 *
 * The router does NOT trust the old AI verdict, client-modified amounts/destinations/policies, or
 * a client-requested execution path. It re-derives everything from the canonical intent + fresh
 * state + the current authoritative policy, then hands the transfer to the existing wallet lane.
 *
 * Lifecycle: plan → ExecutionIntent → [user approval] → ExecutionRouter → STRK20 → verify.
 * The only implemented execution path is `standard` (existing privateTransfer). Shadow execution
 * is NOT implemented in this build and returns SHADOW_UNAVAILABLE — never a silent fallback.
 */
import { SEPOLIA_TOKENS } from '@/config/networks';
import { ExecutionIntent } from '@/ai/plan';
import { PrivateBalanceRow, PortfolioSummary, buildPortfolioSummary } from '@/ai/portfolio';
import { evaluateProposal, TreasuryPolicy, PolicyVerdict } from '@/ai/policy';
import { parseAmountExact } from '@/ai/amount';
import { AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';

export type ExecutionFailureReason =
  | 'EXPIRED'
  | 'STATE_CHANGED'
  | 'POLICY_REJECTED'
  | 'AMOUNT_INVALID'
  | 'UNAUTHORIZED_DESTINATION'
  | 'EXECUTION_FAILED'
  | 'SHADOW_UNAVAILABLE';

export interface ExecutionFailure {
  ok: false;
  reason: ExecutionFailureReason;
  detail: string;
}

export interface ExecutionSuccess {
  ok: true;
  transactionHash: string;
  amountBaseUnits: bigint;
  /** The policy verdict re-run against CURRENT state (evidence for the UI). */
  verdict: PolicyVerdict;
  summary: PortfolioSummary;
  /** The plan's expected outcome — used for post-execution verification. */
  expectedSimulation: ExecutionIntent['expectedSimulation'];
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

export interface ExecuteIntentInput {
  /** The canonical, server-compiled execution intent (from the AgentPlan). */
  intent: ExecutionIntent;
  /** ms epoch when the plan/analysis expires (from /api/ai/analyze). */
  expiresAt: number;
  /** The current authoritative policy (from the analysis response). */
  policy: TreasuryPolicy;
  /** Balances at analysis/plan time (what was sent to /api/ai/analyze). */
  analysisBalances: PrivateBalanceRow[];
  /** Balances freshly re-fetched from the wallet/STRK20 integration at confirm time. */
  currentBalances: PrivateBalanceRow[];
  /** Resolve FRESH prices keyed by raw lowercase token address. */
  resolvePrices: () => Promise<Record<string, AssetPrice>>;
  /**
   * The authoritative Wallet Core session account address (WalletRuntime.getState().account).
   * Client-claimed analysis addresses are ADVISORY ONLY and can NEVER authorize execution — the
   * destination must be THIS wallet's own address or an explicit server-approved destination.
   */
  authoritativeWalletAddress: string;
  /**
   * Server-configured approved external destinations (AI_ALLOWED_DESTINATIONS), canonicalized.
   * The ONLY way a private transfer may target an address other than the active wallet.
   */
  serverAllowedDestinations?: string[];
  /** The Wallet Core STRK20 privateTransfer path (WalletRuntime → WalletPrivacySession). Never anything else. */
  executeTransfer: (opts: { amountBase: bigint; token: string; recipient: string }) => Promise<{ transactionHash: string }>;
  /** Wall-clock override for deterministic tests. */
  now?: number;
}

function canonicalToken(token: string): string {
  const c = canonicalizeAddress(token);
  return c.ok ? c.value : token.toLowerCase();
}

export function balancesEqual(a: PrivateBalanceRow[], b: PrivateBalanceRow[]): boolean {
  const map = new Map<string, bigint>();
  for (const row of a) map.set(canonicalToken(row.token), row.balance);
  for (const row of b) {
    const t = canonicalToken(row.token);
    if (!map.has(t) || map.get(t) !== row.balance) return false;
  }
  return map.size === b.length;
}

export function assetDecimals(asset: string): number {
  const target = canonicalToken(asset);
  const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === target);
  if (meta) return meta.decimals;
  // Unknown asset fallback is never used in the demo path (the route rejects unknown tokens);
  // default to 18 so an unexpected intent still fails safely on balance/precision checks.
  return 18;
}

function humanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The intent's guardrail snapshot must match the current authoritative policy, else re-analyze. */
function policyDiffersFromSnapshot(policy: TreasuryPolicy, snapshot: ExecutionIntent['guardrailSnapshot']): boolean {
  return (
    policy.minLiquidityUsd !== snapshot.minLiquidityUsd ||
    policy.maxPositionPct !== snapshot.maxPositionPct ||
    policy.maxTxUsd !== snapshot.maxTxUsd
  );
}

/**
 * Execute a validated ExecutionIntent ONLY if it is unexpired, state is unchanged, the exact
 * base units reconstruct and match the intent, the guardrail snapshot matches the current policy,
 * and the deterministic policy passes against CURRENT state with FRESH prices.
 *
 * Returns a discriminated result; the UI maps failures to human-readable guidance. The stale AI
 * verdict is never used to authorize execution.
 */
export async function executeIntent(input: ExecuteIntentInput): Promise<ExecutionResult> {
  const now = input.now ?? Date.now();

  // 0. Execution path — the only live path is `standard`. Shadow is NOT implemented here.
  if (input.intent.executionPath !== 'standard') {
    return {
      ok: false,
      reason: 'SHADOW_UNAVAILABLE',
      detail: 'Shadow Account execution is not implemented in this build.',
    };
  }

  // 1. Expiry — at the exact expiration instant the plan is no longer valid.
  if (now >= input.expiresAt) {
    return { ok: false, reason: 'EXPIRED', detail: 'This analysis has expired. Please re-run it.' };
  }

  // 2. State must be unchanged since analysis (a changed balance requires re-analysis).
  if (!balancesEqual(input.analysisBalances, input.currentBalances)) {
    return {
      ok: false,
      reason: 'STATE_CHANGED',
      detail: 'Your private balances changed since this analysis. Please re-run it before executing.',
    };
  }

  // 3. Reconstruct the EXACT base-unit amount and verify it matches the intent (tamper check).
  const decimals = assetDecimals(input.intent.asset);
  const parsed = parseAmountExact(input.intent.amountHuman, decimals);
  if (!parsed.ok || parsed.value <= 0n) {
    return { ok: false, reason: 'AMOUNT_INVALID', detail: parsed.ok ? 'amount must be > 0' : parsed.error };
  }
  if (BigInt(input.intent.amountBaseUnits) !== parsed.value) {
    return {
      ok: false,
      reason: 'AMOUNT_INVALID',
      detail: 'The execution intent amount does not match the reconstructed exact amount.',
    };
  }
  const amountBase = parsed.value;

  // 4. Fresh prices.
  let prices: Record<string, AssetPrice>;
  try {
    prices = await input.resolvePrices();
  } catch {
    return {
      ok: false,
      reason: 'POLICY_REJECTED',
      detail: 'Fresh prices are unavailable. Cannot re-validate the action; please try again.',
    };
  }
  const summary = buildPortfolioSummary(input.currentBalances, prices);

  // 5. Guardrail snapshot integrity — the current authoritative policy must match the plan's.
  if (policyDiffersFromSnapshot(input.policy, input.intent.guardrailSnapshot)) {
    return {
      ok: false,
      reason: 'POLICY_REJECTED',
      detail: 'Your guardrail changed since this plan was created. Please re-run the analysis.',
    };
  }

  // 6. Re-run the deterministic policy against CURRENT state with FRESH prices. The intent's
  //    recipient is the only recipient considered (approved + self-transfer checked by the engine).
  const proposal = {
    intent: 'execution',
    reason: 'ExecutionRouter',
    action: {
      type: 'private_transfer' as const,
      asset: input.intent.asset,
      amount: input.intent.amountHuman,
      recipient: input.intent.recipient,
    },
    requiresUserConfirmation: true,
  };
  const verdict = evaluateProposal(proposal, summary, input.policy, { now });

  // 7. The fresh verdict must allow the action.
  if (!verdict.allowed) {
    const failed = verdict.checks
      .filter((c) => !c.passed)
      .map((c) => `${c.label}: ${c.detail}`)
      .join(' · ');
    return {
      ok: false,
      reason: 'POLICY_REJECTED',
      detail: failed || 'The policy rejected this action against your current state.',
    };
  }

  // 7b. DESTINATION AUTHORIZATION (the hard security gate).
  // The analysis/plan addresses are client-claimed ADVISORY inputs — they can never authorize
  // execution. The destination MUST be the ACTUAL Wallet Core session wallet's own address, or an
  // explicit server-configured approved destination. A malicious client-claimed address in the
  // analysis can never authorize a transfer to it.
  const dest = canonicalToken(input.intent.recipient);
  const selfDest = canonicalToken(input.authoritativeWalletAddress);
  const serverApproved = (input.serverAllowedDestinations ?? []).some(
    (d) => canonicalToken(d) === dest,
  );
  if (dest !== selfDest && !serverApproved) {
    return {
      ok: false,
      reason: 'UNAUTHORIZED_DESTINATION',
      detail:
        'The destination is neither the active wallet nor a server-approved destination. Re-run the analysis from the current wallet.',
    };
  }

  // 8. Execute ONLY through the existing STRK20 privateTransfer path.
  try {
    const res = await input.executeTransfer({
      amountBase,
      token: input.intent.asset,
      recipient: input.intent.recipient,
    });
    if (!res?.transactionHash) {
      return { ok: false, reason: 'EXECUTION_FAILED', detail: 'The wallet returned no transaction hash.' };
    }
    return {
      ok: true,
      transactionHash: res.transactionHash,
      amountBaseUnits: amountBase,
      verdict,
      summary,
      expectedSimulation: input.intent.expectedSimulation,
    };
  } catch (e) {
    return { ok: false, reason: 'EXECUTION_FAILED', detail: humanError(e) };
  }
}