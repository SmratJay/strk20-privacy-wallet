import { describe, it, expect } from 'vitest';
import { evaluateProposal, DEFAULT_TREASURY_POLICY, TreasuryPolicy, PolicyVerdict, MAX_PRICE_AGE_MS } from '@/ai/policy';
import { PortfolioSummary, PortfolioAssetPosition } from '@/ai/portfolio';
import { ActionProposal } from '@/ai/schema';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const STRK_CANON = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

const NOW = 1_700_000_000_000;

function pos(
  token: string,
  symbol: string,
  decimals: number,
  balanceBase: string,
  priceUsd: number,
  priceSource: 'avnu' | 'static',
  liquid: boolean,
  over: Partial<PortfolioAssetPosition> = {},
): PortfolioAssetPosition {
  const balanceHuman = Number(BigInt(balanceBase)) / 10 ** decimals;
  return {
    token, symbol, name: symbol, decimals, balanceBase, balanceHuman,
    usdValue: balanceHuman * priceUsd, priceUsd, priceSource, priceFetchedAt: NOW,
    pct: 0, liquid, ...over,
  };
}

/** $5,000 STRK (50%, FRESH avnu $5) + $5,000 USDC (50%). $10k liquid. */
function summary(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    generatedAt: 1,
    totalUsd: 10000,
    liquidityUsd: 10000,
    liquidPct: 100,
    topAsset: { symbol: 'STRK', pct: 50 },
    positions: [
      pos(STRK, 'STRK', 18, '1000000000000000000000', 5, 'avnu', true),
      pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true),
    ],
    ...over,
  };
}

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, allowedDestinations: [DEST], ...over };
}

function transfer(asset: string, amount: string, recipient = DEST): ActionProposal {
  return { intent: 'rebalance', reason: 'test', action: { type: 'private_transfer', asset, amount, recipient }, requiresUserConfirmation: true };
}

function check(verdict: PolicyVerdict, id: string) {
  return verdict.checks.find((c) => c.id === id);
}

/** Evaluate with a "now" that makes the fresh avnu price 5s old (well within the 60s cap). */
function evalProposal(p: ActionProposal, s: PortfolioSummary, pol: TreasuryPolicy = policy()) {
  return evaluateProposal(p, s, pol, { now: NOW + 5000 });
}

describe('evaluateProposal — happy path', () => {
  it('allows a small compliant transfer with a FRESH live price', () => {
    const v = evalProposal(transfer(STRK, '100'), summary());
    expect(v.allowed).toBe(true);
    expect(v.amountUsd).toBeCloseTo(500, 2);
    expect(v.amountBaseUnits).toBe(100n * 10n ** 18n);
    expect(check(v, 'price-valid')?.passed).toBe(true);
    expect(v.checks.every((c) => c.passed)).toBe(true);
  });

  it('allows advisory reports without execution', () => {
    const v = evalProposal(
      { intent: 'report', reason: 'ok', action: { type: 'report', asset: '', amount: '', recipient: '' }, requiresUserConfirmation: false },
      summary(),
    );
    expect(v.allowed).toBe(true);
    expect(v.reportOnly).toBe(true);
    expect(v.amountBaseUnits).toBe(0n);
  });
});

describe('evaluateProposal — exact balance enforcement (bigint)', () => {
  it('allows an exact full-balance transfer (balance check passes at the boundary)', () => {
    const v = evalProposal(transfer(STRK, '1000'), summary());
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
    expect(v.amountBaseUnits).toBe(1000n * 10n ** 18n);
  });

  it('rejects one smallest unit over the balance', () => {
    const v = evalProposal(transfer(STRK, '1000.000000000000000001'), summary());
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(check(v, 'balance-valid')?.passed).toBe(false);
    expect(v.amountBaseUnits).toBe(1000n * 10n ** 18n + 1n);
  });

  it('handles huge bigint balances without precision loss', () => {
    const s = summary({
      positions: [
        pos(STRK, 'STRK', 18, (10n ** 45n).toString(), 5, 'avnu', true),
        pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true),
      ],
      totalUsd: 5e27,
      liquidityUsd: 5e27,
    });
    const v = evalProposal(transfer(STRK, '100000000000000000000000000'), s, policy({ maxTxUsd: 1e9 }));
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
  });

  it('parses a tiny decimal amount exactly and respects the balance', () => {
    const v = evalProposal(transfer(STRK, '0.000001'), summary());
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(v.amountBaseUnits).toBe(10n ** 12n);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
  });

  it('rejects excessive decimal precision instead of rounding', () => {
    const v = evalProposal(transfer(STRK, '0.0000000000000000001'), summary());
    expect(check(v, 'amount-exact')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });

  it('rejects zero, negative and scientific-notation amounts', () => {
    for (const bad of ['0', '0.000', '-5', '1e5', 'NaN', 'Infinity']) {
      const v = evalProposal(transfer(STRK, bad), summary());
      expect(check(v, 'amount-exact')?.passed, `amount ${JSON.stringify(bad)}`).toBe(false);
      expect(v.allowed).toBe(false);
    }
  });
});

describe('evaluateProposal — destination allowlist', () => {
  it('denies ALL execution when no destinations are approved', () => {
    const v = evaluateProposal(transfer(STRK, '1'), summary(), DEFAULT_TREASURY_POLICY, { now: NOW + 5000 });
    expect(check(v, 'destination-valid')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });

  it('allows only approved destinations — the LLM cannot invent one', () => {
    const ok = evalProposal(transfer(STRK, '1'), summary());
    expect(check(ok, 'destination-valid')?.passed).toBe(true);

    const llmInvented = evalProposal(transfer(STRK, '1', '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'), summary());
    expect(check(llmInvented, 'destination-valid')?.passed).toBe(false);
    expect(llmInvented.allowed).toBe(false);
  });
});

describe('evaluateProposal — volatile price freshness for execution', () => {
  it('accepts a FRESH avnu price', () => {
    const v = evalProposal(transfer(STRK, '1'), summary());
    const price = check(v, 'price-valid');
    expect(price?.passed).toBe(true);
    if (price) expect(price.detail).toMatch(/fresh live market price/);
  });

  it('rejects a STALE avnu price', () => {
    const s = summary({
      positions: [pos(STRK, 'STRK', 18, '1000000000000000000000', 5, 'avnu', true, { priceFetchedAt: NOW - (MAX_PRICE_AGE_MS + 60_000) }), pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true)],
    });
    const v = evaluateProposal(transfer(STRK, '1'), s, policy(), { now: NOW });
    const price = check(v, 'price-valid');
    expect(price?.passed).toBe(false);
    if (price) expect(price.detail).toMatch(/stale/);
    expect(v.allowed).toBe(false);
  });

  it('rejects execution on a volatile asset with a static/fallback price', () => {
    const s = summary({
      positions: [pos(STRK, 'STRK', 18, '1000000000000000000000', 5, 'static', true), pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true)],
    });
    const v = evalProposal(transfer(STRK, '1'), s);
    const price = check(v, 'price-valid');
    expect(price?.passed).toBe(false);
    if (price) expect(price.detail).toMatch(/live price is required/);
    expect(v.allowed).toBe(false);
  });

  it('rejects a volatile price with no timestamp (freshness unknown)', () => {
    const s = summary({
      positions: [pos(STRK, 'STRK', 18, '1000000000000000000000', 5, 'avnu', true, { priceFetchedAt: undefined }), pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true)],
    });
    const v = evalProposal(transfer(STRK, '1'), s);
    expect(check(v, 'price-valid')?.passed).toBe(false);
  });

  it('rejects execution when the price is unknown/zero', () => {
    const s = summary({
      positions: [pos(STRK, 'STRK', 18, '1000000000000000000000', 0, 'avnu', true), pos(USDC, 'USDC', 6, '5000000000', 1, 'static', true)],
    });
    const v = evalProposal(transfer(STRK, '1'), s);
    expect(check(v, 'price-valid')?.passed).toBe(false);
  });

  it('allows stablecoin execution on its pinned $1 price (static is authoritative)', () => {
    const v = evalProposal(transfer(USDC, '10'), summary());
    expect(check(v, 'price-valid')?.passed).toBe(true);
  });
});

describe('evaluateProposal — exact max-tx and liquidity boundaries', () => {
  it('allows a tx exactly at the maxTxUsd cap and rejects one cent over', () => {
    const p = policy({ maxTxUsd: 500 });
    expect(check(evalProposal(transfer(STRK, '100'), summary(), p), 'max-tx-amount')?.passed).toBe(true);
    const over = evalProposal(transfer(STRK, '100.01'), summary(), p);
    expect(check(over, 'max-tx-amount')?.passed).toBe(false);
    expect(over.allowed).toBe(false);
  });

  it('allows liquidity to land exactly on the floor and rejects one cent below', () => {
    const p = policy({ maxTxUsd: 20000 });
    expect(check(evalProposal(transfer(USDC, '9000'), summary(), p), 'min-liquidity-after')?.passed).toBe(true);
    const below = evalProposal(transfer(USDC, '9001'), summary(), p);
    expect(check(below, 'min-liquidity-after')?.passed).toBe(false);
    expect(below.allowed).toBe(false);
  });
});

describe('evaluateProposal — exact integer concentration (cents/bps, no float division)', () => {
  // STRK $60 (6000 cents), USDC $40 (4000 cents). Cap 50%. Transfer STRK $20 (2000 cents)
  // leaves STRK $40 + USDC $40 = $80, both exactly 50% — the boundary.
  function boundarySummary(): PortfolioSummary {
    return {
      generatedAt: 1, totalUsd: 100, liquidityUsd: 100, liquidPct: 100,
      topAsset: { symbol: 'STRK', pct: 60 },
      positions: [
        pos(STRK, 'STRK', 18, (12n * 10n ** 18n).toString(), 5, 'avnu', true),
        pos(USDC, 'USDC', 6, (40n * 10n ** 6n).toString(), 1, 'static', true),
      ],
    };
  }
  function capPolicy(): TreasuryPolicy {
    return { minLiquidityUsd: 0, maxPositionPct: 50, maxTxUsd: 100, allowedAssets: [], allowedDestinations: [DEST] };
  }

  it('passes when a position lands EXACTLY on the concentration limit', () => {
    const v = evalProposal(transfer(STRK, '4'), boundarySummary(), capPolicy());
    const c = check(v, 'max-position-after');
    expect(c?.passed).toBe(true);
  });

  it('fails one cent over the concentration limit', () => {
    const v = evalProposal(transfer(STRK, '4.01'), boundarySummary(), capPolicy());
    const c = check(v, 'max-position-after');
    expect(c?.passed).toBe(false);
  });

  it('large values scale without precision loss (same boundary holds)', () => {
    const scaled = {
      generatedAt: 1, totalUsd: 1e32, liquidityUsd: 1e32, liquidPct: 100,
      topAsset: { symbol: 'STRK', pct: 60 },
      positions: [
        pos(STRK, 'STRK', 18, (12n * 10n ** 48n).toString(), 5, 'avnu', true),
        pos(USDC, 'USDC', 6, (40n * 10n ** 36n).toString(), 1, 'static', true),
      ],
    };
    // scaled amount = 4e30 STRK (same 50% boundary) -> passes; +1 wei -> fails.
    const atLimit = evalProposal(transfer(STRK, '4000000000000000000000000000000'), scaled, capPolicy());
    expect(check(atLimit, 'max-position-after')?.passed).toBe(true);
    const over = evalProposal(transfer(STRK, '4000000000000000000000000000000.000000000000000001'), scaled, capPolicy());
    expect(check(over, 'max-position-after')?.passed).toBe(false);
  });

  it('rejects when a position would exceed the cap after the action', () => {
    const v = evalProposal(transfer(USDC, '2000'), summary(), policy());
    expect(check(v, 'max-position-after')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });
});

describe('evaluateProposal — policy cannot be weakened by the model', () => {
  it('ignores any model-side constraint; the server policy is authoritative', () => {
    const normal = transfer(STRK, '100');
    const withFakeConstraint = { ...normal, constraints: { minLiquidityAfterUsd: 0, maxPositionPctAfter: 100 } } as unknown as ActionProposal;
    const a = evalProposal(normal, summary());
    const b = evalProposal(withFakeConstraint, summary());
    expect(a.allowed).toBe(b.allowed);
    expect(a.checks.map((c) => [c.id, c.passed])).toEqual(b.checks.map((c) => [c.id, c.passed]));
  });
});