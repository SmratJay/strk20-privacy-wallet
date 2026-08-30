/**
 * @file src/ai/policy.ts
 * @description Deterministic treasury policy engine for Hamster AI.
 *
 * The LLM proposes; THIS module decides. It is pure TypeScript with no network access and no
 * LLM — every check is a deterministic function of (proposal, portfolio summary, policy).
 * The user confirms only after this engine says the proposal is allowed.
 *
 * Supported checks:
 *   - asset is present in the treasury (and in `allowedAssets` when configured)
 *   - recipient is non-zero (and in `allowedDestinations` when configured)
 *   - amount parses to > 0 and its USD value ≤ `maxTxUsd`
 *   - liquidity after the action ≥ `minLiquidityUsd`
 *   - no single position exceeds `maxPositionPct` after the action
 */
import { ActionProposal } from '@/ai/schema';
import { PortfolioSummary, PortfolioAssetPosition } from '@/ai/portfolio';

export interface TreasuryPolicy {
  /** USD liquidity that must remain after any action. */
  minLiquidityUsd: number;
  /** Max single-asset allocation (%) after any action. */
  maxPositionPct: number;
  /** Max USD value of any single action. */
  maxTxUsd: number;
  /** Allowed action assets (lowercase 0x). Empty = any portfolio asset. */
  allowedAssets: string[];
  /** Allowed destinations (lowercase 0x). Empty = any non-zero recipient. */
  allowedDestinations: string[];
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  minLiquidityUsd: 1000,
  maxPositionPct: 60,
  maxTxUsd: 5000,
  allowedAssets: [],
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
  /** USD value of the proposed action (0 for reports). */
  amountUsd: number;
  /** True when the proposal is advisory only (no execution). */
  reportOnly: boolean;
}

function positionFor(summary: PortfolioSummary, token: string): PortfolioAssetPosition | undefined {
  return summary.positions.find((p) => p.token === token.toLowerCase());
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
    return { allowed: true, checks, amountUsd: 0, reportOnly: true };
  }

  const action = proposal.action;
  const pos = positionFor(summary, action.asset);

  // 1. asset-valid
  if (!pos) {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: false, detail: `${action.asset} is not a treasury position.` });
  } else if (policy.allowedAssets.length > 0 && !policy.allowedAssets.includes(action.asset.toLowerCase())) {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: false, detail: `${pos.symbol} is not on the allowed-assets list.` });
  } else {
    checks.push({ id: 'asset-valid', label: 'Asset in treasury', passed: true, detail: `${pos.symbol} is a treasury position.` });
  }

  // 2. destination-valid
  const dest = action.recipient.toLowerCase();
  if (!dest || dest === '0x0') {
    checks.push({ id: 'destination-valid', label: 'Destination allowed', passed: false, detail: 'Recipient is empty.' });
  } else if (policy.allowedDestinations.length > 0 && !policy.allowedDestinations.includes(dest)) {
    checks.push({ id: 'destination-valid', label: 'Destination allowed', passed: false, detail: `${dest} is not on the allowed-destinations list.` });
  } else {
    checks.push({ id: 'destination-valid', label: 'Destination allowed', passed: true, detail: `${dest.slice(0, 10)}… is a valid recipient.` });
  }

  // 3. amount + USD value
  const amountHuman = Number(action.amount);
  const amountUsd = amountHuman * (pos?.priceUsd ?? 0);
  if (!Number.isFinite(amountHuman) || amountHuman <= 0) {
    checks.push({ id: 'amount-positive', label: 'Positive amount', passed: false, detail: `amount "${action.amount}" is not > 0.` });
  } else {
    checks.push({ id: 'amount-positive', label: 'Positive amount', passed: true, detail: `${action.amount} ${pos?.symbol ?? 'tokens'}.` });
  }

  // 4. max-tx-amount
  if (amountUsd > policy.maxTxUsd) {
    checks.push({ id: 'max-tx-amount', label: 'Max transaction amount', passed: false, detail: `$${amountUsd.toFixed(2)} exceeds $${policy.maxTxUsd.toFixed(2)} cap.` });
  } else {
    checks.push({ id: 'max-tx-amount', label: 'Max transaction amount', passed: true, detail: `$${amountUsd.toFixed(2)} ≤ $${policy.maxTxUsd.toFixed(2)}.` });
  }

  // 5. min-liquidity-after
  const outflowIsLiquid = pos?.liquid ?? false;
  const liquidityAfter = summary.liquidityUsd - (outflowIsLiquid ? amountUsd : 0);
  if (liquidityAfter < policy.minLiquidityUsd) {
    checks.push({
      id: 'min-liquidity-after',
      label: 'Minimum liquidity kept',
      passed: false,
      detail: `$${liquidityAfter.toFixed(2)} liquid after action < $${policy.minLiquidityUsd.toFixed(2)}.`,
    });
  } else {
    checks.push({
      id: 'min-liquidity-after',
      label: 'Minimum liquidity kept',
      passed: true,
      detail: `$${liquidityAfter.toFixed(2)} liquid after action ≥ $${policy.minLiquidityUsd.toFixed(2)}.`,
    });
  }

  // 6. max-position-after (the action asset decreases by the outflow; others grow in share)
  const actionToken = action.asset.toLowerCase();
  const totalAfter = Math.max(summary.totalUsd - amountUsd, 0);
  let concentrationOk = true;
  let concentrationDetail = 'No position exceeds the concentration cap after the action.';
  for (const p of summary.positions) {
    const valueAfter =
      p.token === actionToken ? Math.max(p.usdValue - amountUsd, 0) : p.usdValue;
    const pctAfter = totalAfter > 0 ? (valueAfter / totalAfter) * 100 : p.pct;
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
  return { allowed, checks, amountUsd, reportOnly: false };
}