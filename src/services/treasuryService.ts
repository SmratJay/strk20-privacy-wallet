/**
 * @file src/services/treasuryService.ts
 * @description Client-side execution gate for the Hamster AI treasury copilot.
 *
 * The `/api/ai/analyze` verdict is NOT an execution authorization token. Before ANY
 * privateTransfer runs, this module enforces, in order:
 *
 *   1. proposal expiry check
 *   2. current wallet/STRK20 state re-fetch (must match the analysis-time state)
 *   3. exact base-unit amount reconstruction (parseAmountExact, asset decimals)
 *   4. deterministic policy re-run against CURRENT state with FRESH prices
 *   5. execution ONLY through the injected existing STRK20 privateTransfer path
 *
 * If the proposal is expired, state changed, or the fresh policy no longer allows the
 * action, execution is refused and the UI must require re-analysis. The stale `allowed`
 * verdict from the analysis response is never used to authorize execution.
 */
import { SEPOLIA_TOKENS } from '@/config/networks';
import { ActionProposal } from '@/ai/schema';
import { buildPortfolioSummary, PrivateBalanceRow, PortfolioSummary } from '@/ai/portfolio';
import { evaluateProposal, TreasuryPolicy, PolicyVerdict } from '@/ai/policy';
import { parseAmountExact } from '@/ai/amount';
import { AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';

export type ExecutionFailureReason =
  | 'EXPIRED'
  | 'STATE_CHANGED'
  | 'POLICY_REJECTED'
  | 'AMOUNT_INVALID'
  | 'EXECUTION_FAILED';

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
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

export interface TreasuryExecutionInput {
  proposal: ActionProposal;
  /** ms epoch when the analysis expires (from /api/ai/analyze). */
  proposalExpiresAt: number;
  /** The server-authoritative policy returned by /api/ai/analyze. */
  policy: TreasuryPolicy;
  /** Balances at analysis time (what was sent to /api/ai/analyze). */
  analysisBalances: PrivateBalanceRow[];
  /** Balances freshly re-fetched from the wallet/STRK20 integration at confirm time. */
  currentBalances: PrivateBalanceRow[];
  /** Resolve FRESH prices keyed by raw lowercase token address. */
  resolvePrices: () => Promise<Record<string, AssetPrice>>;
  /** The EXISTING STRK20 privateTransfer path (Privy or Ready lane). Never anything else. */
  executeTransfer: (opts: {
    amountBase: bigint;
    token: string;
    recipient: string;
  }) => Promise<{ transactionHash: string }>;
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

export function assetDecimals(asset: string, balances: PrivateBalanceRow[]): number {
  const target = canonicalToken(asset);
  const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === target);
  if (meta) return meta.decimals;
  // Unknown asset fallback is never used in the demo path (the route rejects unknown tokens);
  // default to 18 so an unexpected proposal still fails safely on balance/precision checks.
  return 18;
}

export function tokenSymbols(balances: PrivateBalanceRow[]): string[] {
  const set = new Set<string>();
  for (const row of balances) {
    const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(row.token));
    if (meta) set.add(meta.symbol);
  }
  return [...set];
}

function humanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Execute a proposal ONLY if it is unexpired, state is unchanged, the amount reconstructs
 * exactly, and the deterministic policy passes against CURRENT state with FRESH prices.
 * Returns a discriminated result; the UI maps failures to human-readable guidance.
 */
export async function executeProposal(input: TreasuryExecutionInput): Promise<ExecutionResult> {
  const now = input.now ?? Date.now();

  // 1. Expiry.
  if (now > input.proposalExpiresAt) {
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

  // 3. Reconstruct the EXACT base-unit amount.
  const decimals = assetDecimals(input.proposal.action.asset, input.currentBalances);
  const parsed = parseAmountExact(input.proposal.action.amount, decimals);
  if (!parsed.ok || parsed.value <= 0n) {
    return { ok: false, reason: 'AMOUNT_INVALID', detail: parsed.ok ? 'amount must be > 0' : parsed.error };
  }
  const amountBase = parsed.value;

  // 4. Re-run the deterministic policy against CURRENT state with FRESH prices.
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
  const verdict = evaluateProposal(input.proposal, summary, input.policy, { now });

  // 5. The fresh verdict must allow the action.
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

  // 6. Execute ONLY through the existing STRK20 privateTransfer path.
  try {
    const res = await input.executeTransfer({
      amountBase,
      token: input.proposal.action.asset,
      recipient: input.proposal.action.recipient,
    });
    if (!res?.transactionHash) {
      return { ok: false, reason: 'EXECUTION_FAILED', detail: 'The wallet returned no transaction hash.' };
    }
    return { ok: true, transactionHash: res.transactionHash, amountBaseUnits: amountBase, verdict, summary };
  } catch (e) {
    return { ok: false, reason: 'EXECUTION_FAILED', detail: humanError(e) };
  }
}