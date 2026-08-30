/**
 * @file src/services/treasuryService.ts
 * @description Request building + LEGACY execution adapter for the Hamster AI treasury copilot.
 *
 * The canonical execution path is the ExecutionRouter (`src/ai/execution.ts`), which consumes a
 * validated `ExecutionIntent` from an AgentPlan. `executeProposal` here is kept ONLY as a
 * backwards-compatible adapter (used by existing tests and legacy callers): it converts a legacy
 * `ActionProposal` into an `ExecutionIntent` and delegates to the router. New code should execute
 * via `executeIntent` with the plan's intent.
 *
 * Security invariants are enforced by the router, never by this adapter: expiry, state re-check,
 * exact bigint reconstruction + tamper check, guardrail-snapshot integrity, deterministic policy
 * re-run against fresh state/prices, and execution ONLY through the injected STRK20 privateTransfer.
 */
import { SEPOLIA_TOKENS } from '@/config/networks';
import { ActionProposal } from '@/ai/schema';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';
import { TreasuryPolicy, UserPolicySelection, simulateAction } from '@/ai/policy';
import { parseAmountExact } from '@/ai/amount';
import { AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';
import { ExecutionIntent } from '@/ai/plan';
import { executeIntent, assetDecimals, ExecutionResult } from '@/ai/execution';

export { executeIntent } from '@/ai/execution';
export type {
  ExecutionResult,
  ExecutionSuccess,
  ExecutionFailure,
  ExecutionFailureReason,
  ExecuteIntentInput,
} from '@/ai/execution';

function canonicalToken(token: string): string {
  const c = canonicalizeAddress(token);
  return c.ok ? c.value : token.toLowerCase();
}

export function tokenSymbols(balances: PrivateBalanceRow[]): string[] {
  const set = new Set<string>();
  for (const row of balances) {
    const meta = SEPOLIA_TOKENS.find((t) => canonicalToken(t.address) === canonicalToken(row.token));
    if (meta) set.add(meta.symbol);
  }
  return [...set];
}

/**
 * Resolve the STRK20 private treasury identity for the UI + analyze context.
 *
 * For the Privy lane this is the Ready-derived account
 * (`computeReadyAccountAddress(publicKey)`) — the address the existing STRK20 integration
 * registers as the private-note owner and uses as the SOURCE of every private transfer. Both
 * `privy.account.address` and the Privy context `address` carry this derived identity (the
 * Privy wallet's own `wallet.address` is NOT the STRK20 identity). For the Ready/Wallet-API
 * lane the connected account IS the STRK20 identity. This is NOT the SDK's separate
 * "Shadow Account" concept.
 */
export function resolvePrivateTreasuryAddress(opts: {
  privyConnected: boolean;
  privyAccountAddress?: string | null;
  privyAddress?: string | null;
  walletAddress?: string | null;
}): string {
  if (opts.privyConnected) {
    return (opts.privyAccountAddress ?? opts.privyAddress ?? '').trim();
  }
  return (opts.walletAddress ?? '').trim();
}

/**
 * JSON-safe request body for `/api/ai/analyze`.
 *
 * Internal balances are `bigint`; at the HTTP boundary they are serialized as decimal
 * strings (`balance.toString()`). The server converts back with `BigInt(balance)`. This
 * keeps internal financial arithmetic exact while preventing `JSON.stringify` from throwing
 * on a BigInt.
 */
export interface AnalyzeRequestBody {
  prompt: string;
  balances: { token: string; balance: string }[];
  context: { userAddress: string; privateTreasuryAddress: string };
  /** The user-selected guardrail; the server validates bounds and the AI can never change it. */
  policy?: UserPolicySelection;
  /** Compact recent private transfers (the user's own activity). Optional. */
  recentActivity?: { id: string; amount: string; tokenSymbol: string; status: string }[];
}

export function buildAnalyzeRequest(input: {
  prompt: string;
  balances: PrivateBalanceRow[];
  userAddress: string;
  privateTreasuryAddress: string;
  policy?: UserPolicySelection;
  recentActivity?: { id: string; amount: string; tokenSymbol: string; status: string }[];
}): AnalyzeRequestBody {
  return {
    prompt: input.prompt.trim(),
    balances: input.balances.map((row) => ({
      token: row.token,
      balance: row.balance.toString(),
    })),
    context: {
      userAddress: input.userAddress,
      privateTreasuryAddress: input.privateTreasuryAddress,
    },
    policy: input.policy,
    recentActivity: input.recentActivity,
  };
}

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

/**
 * LEGACY adapter: convert a legacy `ActionProposal` into an `ExecutionIntent` and delegate to the
 * ExecutionRouter. All security gates live in the router; this only maps inputs.
 */
export async function executeProposal(input: TreasuryExecutionInput): Promise<ExecutionResult> {
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
  const parsed = parseAmountExact(input.proposal.action.amount, assetDecimals(input.proposal.action.asset));
  const intent: ExecutionIntent = {
    executionPath: 'standard',
    asset: input.proposal.action.asset,
    amountHuman: input.proposal.action.amount,
    amountBaseUnits: (parsed.ok ? parsed.value : 0n).toString(),
    recipient: input.proposal.action.recipient,
    guardrailSnapshot: {
      minLiquidityUsd: input.policy.minLiquidityUsd,
      maxPositionPct: input.policy.maxPositionPct,
      maxTxUsd: input.policy.maxTxUsd,
    },
    expectedSimulation: simulateAction(summary, input.policy, {
      asset: input.proposal.action.asset,
      amount: input.proposal.action.amount,
    }),
  };
  return executeIntent({
    intent,
    expiresAt: input.proposalExpiresAt,
    policy: input.policy,
    analysisBalances: input.analysisBalances,
    currentBalances: input.currentBalances,
    resolvePrices: async () => prices,
    executeTransfer: input.executeTransfer,
    now: input.now,
  });
}