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
  /**
   * The STRK20 private treasury identity (the SOURCE account of every private transfer).
   * Any proposal whose recipient equals this is a meaningless self-transfer and is rejected
   * deterministically — the LLM can never route a transfer back to the source identity.
   */
  selfTransferAddress?: string;
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

/** Volatile (STRK/ETH) live prices older than this are stale and cannot authorize execution. */
export const MAX_PRICE_AGE_MS = 60_000;

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

/** Price in whole cents for a position's unit (min 1; 0 when the price is unusable). */
function priceCentsOf(p: PortfolioAssetPosition): bigint {
  if (!Number.isFinite(p.priceUsd) || p.priceUsd <= 0) return 0n;
  return BigInt(Math.max(1, Math.ceil(p.priceUsd * 100)));
}

/** Exact USD cents for a position, derived from its base balance (never float usdValue). */
function positionCents(p: PortfolioAssetPosition): bigint {
  const priceCents = priceCentsOf(p);
  if (priceCents === 0n) return 0n;
  return ceilDiv(BigInt(p.balanceBase) * priceCents, 10n ** BigInt(p.decimals));
}

export interface EvaluateOptions {
  /** Wall-clock for price-freshness checks. Defaults to Date.now(); pass for determinism. */
  now?: number;
}

export interface ExecutionPolicyInput {
  /** The user's primary public account address. */
  userAddress?: string;
  /** The STRK20 private treasury identity address (the AI treasury's note-owner). */
  privateTreasuryAddress?: string;
  /** Server-configured extra approved destinations (canonicalized here). */
  allowedDestinations?: string[];
  /** Server-configured allowed action assets (canonicalized here). */
  allowedAssets?: string[];
  /** Base policy to inherit liquidity/concentration/tx limits from. */
  base?: TreasuryPolicy;
}

export type BuildPolicyResult =
  | { ok: true; policy: TreasuryPolicy }
  | { ok: false; error: string };

/**
 * Build the SERVER-authoritative execution policy.
 *
 * Destinations are ONLY: the user's primary account and any server-configured allowlist.
 * The STRK20 private treasury identity is the SOURCE of every transfer and is therefore NOT
 * AI-selectable; it is recorded as `selfTransferAddress` so the policy can deterministically
 * reject a meaningless self-transfer. Every address is canonicalized. An empty destination
 * set DENIES all execution (the policy engine enforces it) — the LLM can never add one.
 */
export function buildExecutionPolicy(input: ExecutionPolicyInput): BuildPolicyResult {
  const base = input.base ?? DEFAULT_TREASURY_POLICY;

  const allowedAssets: string[] = [];
  for (const a of input.allowedAssets ?? []) {
    const c = canonicalizeAddress(a);
    if (!c.ok) return { ok: false, error: `invalid allowed asset: ${a}` };
    if (!allowedAssets.includes(c.value)) allowedAssets.push(c.value);
  }

  const allowedDestinations: string[] = [];
  const destCandidates = [input.userAddress, ...(input.allowedDestinations ?? [])];
  for (const d of destCandidates) {
    if (!d || d.trim() === '') continue;
    const c = canonicalizeAddress(d);
    if (!c.ok) return { ok: false, error: `invalid destination: ${d}` };
    if (!allowedDestinations.includes(c.value)) allowedDestinations.push(c.value);
  }

  let selfTransferAddress: string | undefined;
  if (input.privateTreasuryAddress) {
    const c = canonicalizeAddress(input.privateTreasuryAddress);
    if (!c.ok) return { ok: false, error: `invalid private treasury address: ${input.privateTreasuryAddress}` };
    selfTransferAddress = c.value;
  }

  return {
    ok: true,
    policy: {
      ...base,
      allowedAssets,
      allowedDestinations,
      selfTransferAddress,
    },
  };
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
  opts: EvaluateOptions = {},
): PolicyVerdict {
  const checks: PolicyCheck[] = [];
  const now = opts.now ?? Date.now();

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

  // 2b. self-transfer — the source of every private transfer is the private treasury
  //     identity; routing a transfer back to it would be a meaningless no-op. Rejected
  //     deterministically regardless of what the LLM proposes.
  if (policy.selfTransferAddress) {
    const src = canonicalizeAddress(policy.selfTransferAddress);
    const dst = canonicalizeAddress(action.recipient);
    const isSelf = src.ok && dst.ok && src.value === dst.value;
    checks.push({
      id: 'self-transfer',
      label: 'Not a self-transfer',
      passed: !isSelf,
      detail: isSelf
        ? `${dst.value.slice(0, 10)}… is the treasury identity itself; this would be a no-op.`
        : 'Recipient differs from the source treasury identity.',
    });
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

  // 5. price-valid-for-execution — a FRESH live price is required for volatile assets.
  let priceOk = false;
  let priceDetail = 'No usable price.';
  if (pos) {
    if (!Number.isFinite(pos.priceUsd) || pos.priceUsd <= 0) {
      priceDetail = `${pos.symbol} has no usable price (${pos.priceUsd}).`;
    } else if (STABLECOIN_SYMBOLS.has(pos.symbol)) {
      priceOk = true;
      priceDetail = `${pos.symbol} is a stablecoin pinned at $1.`;
    } else if (pos.priceSource !== 'avnu') {
      priceDetail = `${pos.symbol} price is ${pos.priceSource} (fallback). A fresh live price is required to authorize execution.`;
    } else {
      const fetchedAt = pos.priceFetchedAt;
      if (fetchedAt === undefined) {
        priceDetail = `${pos.symbol} price has no timestamp; freshness cannot be verified.`;
      } else {
        const ageMs = now - fetchedAt;
        if (ageMs < 0 || ageMs > MAX_PRICE_AGE_MS) {
          priceDetail = `${pos.symbol} price is stale (${Math.max(0, Math.round(ageMs / 1000))}s old; max ${MAX_PRICE_AGE_MS / 1000}s).`;
        } else {
          priceOk = true;
          priceDetail = `${pos.symbol} has a fresh live market price (source: avnu, ${Math.round(ageMs / 1000)}s old).`;
        }
      }
    }
  }
  checks.push({ id: 'price-valid', label: 'Fresh live price for execution', passed: priceOk, detail: priceDetail });

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

  // 8. max-position-after — EXACT integer comparison in cents/bps (no float division).
  //    positionAfterCents * 10000 <= totalAfterCents * maxPositionBps
  const totalCents = summary.positions.reduce((s, p) => s + positionCents(p), 0n);
  const totalAfterCents = totalCents > amountUsdCents ? totalCents - amountUsdCents : 0n;
  const maxPositionBps = BigInt(Math.max(0, Math.round(policy.maxPositionPct * 100)));
  let concentrationOk = true;
  let concentrationDetail = 'No position exceeds the concentration cap after the action.';
  for (const p of summary.positions) {
    const pCents = positionCents(p);
    if (pCents === 0n) continue; // no valued position -> cannot exceed a concentration cap
    const pCanonical = canonicalizeAddress(p.token);
    const actionCanonical = canonicalizeAddress(action.asset);
    const isActionAsset =
      pCanonical.ok && actionCanonical.ok && pCanonical.value === actionCanonical.value;
    const afterCents = isActionAsset
      ? (pCents > amountUsdCents ? pCents - amountUsdCents : 0n)
      : pCents;
    // Integer cross-multiplication: pass iff afterCents <= cap% of totalAfterCents.
    if (afterCents * 10000n > totalAfterCents * maxPositionBps) {
      const pctAfterBps = totalAfterCents > 0n ? (afterCents * 10000n) / totalAfterCents : 0n;
      concentrationOk = false;
      concentrationDetail = `${p.symbol} would be ${(Number(pctAfterBps) / 100).toFixed(2)}% after the action (cap ${policy.maxPositionPct}%).`;
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