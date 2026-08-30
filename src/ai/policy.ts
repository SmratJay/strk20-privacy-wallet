/**
 * @file src/ai/policy.ts
 * @description Deterministic treasury policy engine for Hamster AI.
 *
 * The LLM proposes; THIS module decides. It is pure TypeScript with no network access and no
 * LLM — every check is a deterministic function of (proposal, portfolio summary, policy).
 * The user confirms only after this engine says the proposal is allowed.
 *
 * Financial decisions use EXACT bigint base units (never floats):
 *   - the proposed amount is parsed with `parseAmountExact` using the asset's decimals
 *   - `proposedBaseUnits <= position.balanceBase` is enforced before any action is allowed
 *   - USD amounts are computed conservatively in cents via bigint (price rounded UP)
 *
 * Safety rules:
 *   - destinations must be explicitly approved (`allowedDestinations`). An EMPTY allowlist
 *     DENIES everything — the LLM can never invent a destination.
 *   - executable actions on volatile assets (STRK/ETH) require a LIVE (`avnu`) price; a
 *     static/fallback price can only feed advisory analysis, never authorize execution.
 *   - advisory `report` proposals never execute.
 */
import { ActionProposal } from '@/ai/schema';
import { PortfolioSummary, PortfolioAssetPosition } from '@/ai/portfolio';
import { parseAmountExact, isZeroAmount } from '@/ai/amount';
import { canonicalizeAddress } from '@/ai/address';

export interface TreasuryPolicy {
  /** USD liquidity that must remain after any action. */
  minLiquidityUsd: number;
  /** Max single-asset allocation (%) after any action. */
  maxPositionPct: number;
  /** Max USD value of any single action. */
  maxTxUsd: number;
  /** Allowed action assets (canonical lowercase 0x). Empty = any treasury position. */
  allowedAssets: string[];
  /** Approved destinations (canonical lowercase 0x). EMPTY = deny all execution. */
  allowedDestinations: string[];
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  minLiquidityUsd: 1000,
  maxPositionPct: 60,
  maxTxUsd: 5000,
  allowedAssets: [],
  // Empty = deny: an AI-controlled treasury never executes to an unapproved destination.
  allowedDestinations: [],
};

export interface PolicyCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface PolicyVerdict {
  allowed: boolean;
  checks: PolicyCheck[];
  /** Proposed amount in EXACT base units (0 for reports). */
  amountBaseUnits: bigint;
  /** Conservative USD value of the proposed action (0 for reports). */
  amountUsd: number;
  /** True when the proposal is advisory only (no execution). */
  reportOnly: boolean;
}

/** Stablecoins pinned at $1 (static price is authoritative for them). */
const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT']);

function positionFor(summary: PortfolioSummary, token: string): PortfolioAssetPosition | undefined {
  const canonical = canonicalizeAddress(token);
  if (!canonical.ok) return undefined;
  return summary.positions.find((p) => {
    const pCanonical = canonicalizeAddress(p.token);
    return pCanonical.ok && pCanonical.value === canonical.value;
  });
}

/** ceil(x) in cents as a bigint-safe guard against understating USD exposure. */
function usdCents(valueUsd: number): bigint {
  if (!Number.isFinite(valueUsd) || valueUsd <= 0) return 0n;
  return BigInt(Math.ceil(valueUsd * 100));
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a % b === 0n ? a / b : a / b + 1n;
}

/**
 * Evaluate a proposal against the treasury policy + current portfolio.
 * Deterministic and pure — callable from the API route AND re-runnable client-side before
 * the Confirm button enables.
 */
export function evaluateProposal(
  proposal: ActionProposal,
  summary: PortfolioSummary,
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
): PolicyVerdict {
  const checks: PolicyCheck[] = [];

  // Advisory reports never execute and always pass.
  if (proposal.action.type === 'report') {
    checks.push({ id: 'report-only', label: 'Advisory report', passed: true, detail: 'No state change; nothing executes.' });
    return { allowed: true, checks, amountBaseUnits: 0n, amountUsd: 0, reportOnly: true };
  }

  const action = proposal.action;
  const pos = positionFor(summary, action.asset);

  // 1. asset-valid
  if (!pos) {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: false, detail: `${action.asset} is not a treasury position.` });
  } else if (policy.allowedAssets.length > 0 && !policy.allowedAssets.includes(action.asset)) {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: false, detail: `${pos.symbol} is not on the allowed-assets list.` });
  } else {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: true, detail: `${pos.symbol} is a treasury position.` });
  }

  // 2. destination-valid — EXPLICIT allowlist only. Empty allowlist denies everything.
  const dest = action.recipient;
  if (policy.allowedDestinations.length === 0) {
    checks.push({ id: 'destination-valid', label: 'Destination approved', passed: false, detail: 'No destinations are approved; the treasury cannot execute to anywhere yet.' });
  } else if (!policy.allowedDestinations.includes(dest)) {
    checks.push({ id: 'destination-valid', label: 'Destination approved', passed: false, detail: `${dest} is not an approved destination.` });
  } else {
    checks.push({ id: 'destination-valid', label: 'Destination approved', passed: true, detail: `${dest.slice(0, 10)}… is an approved destination.` });
  }

  // 3. amount — EXACT base units via the asset's decimals.
  let baseUnits = 0n;
  if (!pos) {
    checks.push({ id: 'amount-exact', label: 'Exact amount', passed: false, detail: 'Cannot parse amount: asset not in treasury.' });
  } else if (isZeroAmount(action.amount)) {
    checks.push({ id: 'amount-exact', label: 'Exact amount', passed: false, detail: 'amount must be > 0.' });
  } else {
    const parsed = parseAmountExact(action.amount, pos.decimals);
    if (!parsed.ok) {
      checks.push({ id: 'amount-exact', label: 'Exact amount', passed: false, detail: parsed.error });
    } else {
      baseUnits = parsed.value;
      checks.push({
        id: 'amount-exact',
        label: 'Exact amount',
        passed: true,
        detail: `${action.amount} ${pos.symbol} = ${baseUnits} base units (${pos.decimals} dp).`,
      });
    }
  }

  // 4. balance-valid — proposed base units must not exceed the position.
  let balanceOk = false;
  if (!pos) {
    checks.push({ id: 'balance-valid', label: 'Balance covers amount', passed: false, detail: 'No position to draw from.' });
  } else {
    const balance = BigInt(pos.balanceBase);
    balanceOk = baseUnits <= balance;
    checks.push({
      id: 'balance-valid',
      label: 'Balance covers amount',
      passed: balanceOk,
      detail: balanceOk
        ? `${action.amount} ≤ ${pos.symbol} balance (${balance} base units).`
        : `Proposed ${baseUnits} base units exceeds the ${pos.symbol} balance of ${balance}.`,
    });
  }

  // 5. price-valid-for-execution — live price required for volatile assets.
  let priceOk = false;
  let priceDetail = 'No usable price.';
  if (pos) {
    if (!Number.isFinite(pos.priceUsd) || pos.priceUsd <= 0) {
      priceDetail = `${pos.symbol} has no usable price (${pos.priceUsd}).`;
    } else if (STABLECOIN_SYMBOLS.has(pos.symbol)) {
      priceOk = true;
      priceDetail = `${pos.symbol} is a stablecoin pinned at $1.`;
    } else if (pos.priceSource === 'avnu') {
      priceOk = true;
      priceDetail = `${pos.symbol} has a live market price (source: avnu).`;
    } else {
      priceDetail = `${pos.symbol} price is ${pos.priceSource} (fallback). A live price is required to authorize execution.`;
    }
  }
  checks.push({ id: 'price-valid', label: 'Live price for execution', passed: priceOk, detail: priceDetail });

  // Conservative USD value in cents (price rounded UP, division ceil) — exact bigint math.
  const priceCents = pos ? BigInt(Math.max(1, Math.ceil(pos.priceUsd * 100))) : 0n;
  const oneToken = pos ? 10n ** BigInt(pos.decimals) : 1n;
  const amountUsdCents = pos ? ceilDiv(baseUnits * priceCents, oneToken) : 0n;
  const amountUsd = Number(amountUsdCents) / 100;

  // 6. max-tx-amount (exact cents comparison).
  const maxTxCents = usdCents(policy.maxTxUsd);
  if (amountUsdCents > maxTxCents) {
    checks.push({ id: 'max-tx-amount', label: 'Max transaction amount', passed: false, detail: `$${amountUsd.toFixed(2)} exceeds the $${policy.maxTxUsd.toFixed(2)} cap.` });
  } else {
    checks.push({ id: 'max-tx-amount', label: 'Max transaction amount', passed: true, detail: `$${amountUsd.toFixed(2)} ≤ $${policy.maxTxUsd.toFixed(2)}.` });
  }

  // 7. min-liquidity-after (conservative cents).
  const outflowIsLiquid = pos?.liquid ?? false;
  const liquidityAfterCents = usdCents(summary.liquidityUsd) - (outflowIsLiquid ? amountUsdCents : 0n);
  const minLiquidityCents = usdCents(policy.minLiquidityUsd);
  const liquidityAfterUsd = Number(liquidityAfterCents) / 100;
  if (liquidityAfterCents < minLiquidityCents) {
    checks.push({
      id: 'min-liquidity-after',
      label: 'Minimum liquidity kept',
      passed: false,
      detail: `$${liquidityAfterUsd.toFixed(2)} liquid after the action < $${policy.minLiquidityUsd.toFixed(2)}.`,
    });
  } else {
    checks.push({
      id: 'min-liquidity-after',
      label: 'Minimum liquidity kept',
      passed: true,
      detail: `$${liquidityAfterUsd.toFixed(2)} liquid after the action ≥ $${policy.minLiquidityUsd.toFixed(2)}.`,
    });
  }

  // 8. max-position-after (the action asset decreases by the outflow; others grow in share).
  const totalAfterUsd = Math.max(summary.totalUsd - amountUsd, 0);
  let concentrationOk = true;
  let concentrationDetail = 'No position exceeds the concentration cap after the action.';
  for (const p of summary.positions) {
    const pCanonical = canonicalizeAddress(p.token);
    const isActionAsset = pCanonical.ok && pCanonical.value === action.asset;
    const valueAfter = isActionAsset ? Math.max(p.usdValue - amountUsd, 0) : p.usdValue;
    const pctAfter = totalAfterUsd > 0 ? (valueAfter / totalAfterUsd) * 100 : p.pct;
    if (pctAfter > policy.maxPositionPct) {
      concentrationOk = false;
      concentrationDetail = `${p.symbol} would be ${pctAfter.toFixed(1)}% after the action (cap ${policy.maxPositionPct}%).`;
      break;
    }
  }
  checks.push({
    id: 'max-position-after',
    label: 'Max position concentration',
    passed: concentrationOk,
    detail: concentrationDetail,
  });

  const allowed = checks.every((c) => c.passed);
  return { allowed, checks, amountBaseUnits: baseUnits, amountUsd, reportOnly: false };
}