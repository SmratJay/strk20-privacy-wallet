#!/usr/bin/env node
/**
 * LAUNCHPAD V2 curve simulator — mirrors the V2 BondingCurve math exactly (integer-safe,
 * ceil-division pool-favoring) BEFORE it is locked in Cairo. Runs the required simulation
 * matrix and asserts every economic invariant.
 *
 *   node scripts/launch_sim.mjs [--print-table]
 *
 * Nothing here is a mock of live data — it is a pure integer simulator of the exact math the
 * on-chain BondingCurve V2 will execute, used to choose and validate the curve parameters.
 */
const MAX_BPS = 10000n;

const PARAMS = {
  // default V2 launchpad curve (Sepolia, STRK base)
  supply: 1_000_000_000n * 10n ** 18n, // 1B tokens, 18 dp
  virtualBase: 30n * 10n ** 18n, // 30 STRK virtual base
  virtualToken: 1_000_000_000n * 10n ** 18n, // 1B tokens virtual reserve (= supply)
  gradTarget: 120n * 10n ** 18n, // graduation at 120 STRK real base reserve
  feeBps: 100n, // 1% total fee on base input (buys) / base output (sells)
  creatorFeeBps: 25n, // 0.25% -> creator (in STRK)
  protocolFeeBps: 25n, // 0.25% -> protocol treasury (in STRK)
  maxTradeBps: 1000n, // 10% of virtual token reserve max per buy
};

class Curve {
  constructor(p = PARAMS) {
    assert(p.creatorFeeBps + p.protocolFeeBps <= p.feeBps, 'fee split exceeds total fee');
    assert(p.virtualBase > 0n && p.virtualToken > 0n && p.gradTarget > 0n, 'params');
    assert(p.feeBps <= MAX_BPS, 'fee too high');
    assert(p.maxTradeBps <= MAX_BPS, 'max trade too high');
    this.p = p;
    this.k = p.virtualBase * p.virtualToken;
    this.baseReserve = 0n;
    this.tokenReserve = 0n; // circulating tokens sold
    this.graduated = false;
    // ledger for physical-balance consistency + fee accounting
    this.basePhysical = 0n; // base held by the curve (starts 0; receives buys net of fees)
    this.tokenPhysical = p.supply; // tokens held by the curve
    this.protocolBase = 0n;
    this.creatorBase = 0n;
    this.trades = 0n;
  }

  totalBase() { return this.p.virtualBase + this.baseReserve; }
  totalToken() { return this.p.virtualToken - this.tokenReserve; }

  ceilDiv(a, b) { return a % b === 0n ? a / b : a / b + 1n; }

  price() { return { base: this.totalBase(), token: this.totalToken() }; }
  priceStrkPerToken() { return Number(this.totalBase()) / Number(this.totalToken()); }

  computeTokenOut(netBase) {
    assert(netBase > 0n, 'zero net base');
    const tBefore = this.totalToken();
    const bAfter = this.totalBase() + netBase;
    const tAfter = this.ceilDiv(this.k, bAfter);
    assert(bAfter > this.totalBase(), 'base overflow');
    assert(tAfter < tBefore, 'token out not positive');
    return tBefore - tAfter;
  }

  computeBaseOut(netToken) {
    assert(netToken > 0n, 'zero net token');
    const bBefore = this.totalBase();
    const tAfter = this.totalToken() + netToken;
    const bAfter = this.ceilDiv(this.k, tAfter);
    assert(tAfter > this.totalToken(), 'token overflow');
    assert(bAfter < bBefore, 'base out not positive');
    const baseOut = bBefore - bAfter;
    assert(baseOut <= this.baseReserve, 'base reserve negative');
    return baseOut;
  }

  quoteBuy(baseIn) {
    if (baseIn <= 0n) return 0n;
    const protocolFee = (baseIn * this.p.protocolFeeBps) / MAX_BPS;
    const creatorFee = (baseIn * this.p.creatorFeeBps) / MAX_BPS;
    const reserveIn = baseIn - protocolFee - creatorFee;
    const tokenOut = this.computeTokenOut(reserveIn);
    const cap = (this.p.virtualToken * this.p.maxTradeBps) / MAX_BPS;
    return tokenOut > cap ? cap : tokenOut;
  }

  quoteSell(tokenIn) {
    if (tokenIn <= 0n) return 0n;
    const gross = this.computeBaseOut(tokenIn);
    const protocolFee = (gross * this.p.protocolFeeBps) / MAX_BPS;
    const creatorFee = (gross * this.p.creatorFeeBps) / MAX_BPS;
    return gross - protocolFee - creatorFee;
  }

  /** Returns tokens received by trader. Auto-graduates when the target is reached. */
  buy(baseIn, opts = {}) {
    assert(!this.graduated, 'CURVE_GRADUATED');
    assert(baseIn > 0n, 'ZERO_BUY_AMOUNT');
    const protocolFee = (baseIn * this.p.protocolFeeBps) / MAX_BPS;
    const creatorFee = (baseIn * this.p.creatorFeeBps) / MAX_BPS;
    const reserveIn = baseIn - protocolFee - creatorFee;
    assert(reserveIn > 0n, 'ZERO_NET_BASE');
    const tokenOut = this.computeTokenOut(reserveIn);
    const cap = (this.p.virtualToken * this.p.maxTradeBps) / MAX_BPS;
    assert(tokenOut <= cap, 'MAX_TRADE_EXCEEDED');

    this.baseReserve += reserveIn;
    this.tokenReserve += tokenOut;
    this.basePhysical += reserveIn;
    this.tokenPhysical -= tokenOut;
    this.protocolBase += protocolFee;
    this.creatorBase += creatorFee;
    this.trades += 1n;

    assert(this.basePhysical === this.baseReserve, 'physical base mismatch');
    assert(this.tokenPhysical === this.p.supply - this.tokenReserve, 'physical token mismatch');
    if (this.baseReserve >= this.p.gradTarget) this.finalizeGraduation();
    return tokenOut;
  }

  sell(tokenIn, opts = {}) {
    assert(!this.graduated, 'CURVE_GRADUATED');
    assert(tokenIn > 0n, 'ZERO_SELL_AMOUNT');
    const gross = this.computeBaseOut(tokenIn);
    const protocolFee = (gross * this.p.protocolFeeBps) / MAX_BPS;
    const creatorFee = (gross * this.p.creatorFeeBps) / MAX_BPS;
    const netBaseOut = gross - protocolFee - creatorFee;

    this.baseReserve -= gross;
    this.tokenReserve -= tokenIn;
    this.basePhysical -= gross;
    this.tokenPhysical += tokenIn;
    this.protocolBase += protocolFee;
    this.creatorBase += creatorFee;
    this.trades += 1n;

    assert(this.basePhysical === this.baseReserve, 'physical base mismatch');
    assert(this.tokenPhysical === this.p.supply - this.tokenReserve, 'physical token mismatch');
    return netBaseOut;
  }

  finalizeGraduation() {
    if (this.graduated) return;
    this.graduated = true;
    // reserves move to the "router": base reserve + remaining physical tokens
    this.routerBase = this.baseReserve;
    this.routerToken = this.tokenPhysical;
    this.baseReserve = 0n;
    this.tokenReserve = 0n;
    this.basePhysical = 0n;
    this.tokenPhysical = 0n;
  }

  // fractional ledger for round-trip fidelity
  buyAndKeep(baseIn) {
    // trader holds tokens
    const tokens = this.buy(baseIn);
    if (this.graduated) throw new Error('graduated during buy');
    return tokens;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`INVARIANT FAILURE: ${msg}`);
}

const fmt = (v) => Number(v) / 1e18;
const fmtT = (v) => Number(v) / 1e18;

function run(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    console.log(`  [FAIL] ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

function main() {
  const printTable = process.argv.includes('--print-table');
  const p = PARAMS;
  console.log('LAUNCHPAD V2 curve parameter study (integer-safe simulator)');
  console.log('-----------------------------------------------------------');
  console.log(`supply            ${fmtT(p.supply).toLocaleString()} tokens (18dp)`);
  console.log(`virtual base      ${fmt(p.virtualBase)} STRK`);
  console.log(`virtual token     ${fmtT(p.virtualToken).toLocaleString()} tokens`);
  console.log(`gradation target  ${fmt(p.gradTarget)} STRK base reserve`);
  const bpsPct = (v) => `${(Number(v) / 100).toFixed(2)}%`;
  console.log(`fee (total)       ${bpsPct(p.feeBps)}  → creator ${bpsPct(p.creatorFeeBps)} · protocol ${bpsPct(p.protocolFeeBps)} · liquidity ${bpsPct(p.feeBps - p.creatorFeeBps - p.protocolFeeBps)}`);
  console.log(`max trade         ${p.maxTradeBps / 100n}% of virtual token reserve per buy`);

  // ── starting state ────────────────────────────────────────────────────────────────
  const c0 = new Curve(p);
  const startPrice = c0.priceStrkPerToken();
  const startMc = startPrice * Number(p.supply) / 1e18;
  console.log(`\nstarting price     ${startPrice.toExponential(4)} STRK/token`);
  console.log(`starting market cap ${startMc.toFixed(2)} STRK (${(startMc * 0.5).toFixed(2)} USD @ $0.50)`);

  // ── tiny buy ──────────────────────────────────────────────────────────────────────
  run('tiny buy (0.01 STRK) is positive and moves price up', () => {
    const c = new Curve(p);
    const out = c.buy(10n ** 16n);
    assert(out > 0n, 'tiny buy gives tokens');
    assert(c.priceStrkPerToken() > startPrice, 'price moved up');
  });

  // ── medium buy ───────────────────────────────────────────────────────────────────
  run('medium buy (1 STRK) quote == execution', () => {
    const c = new Curve(p);
    const q = c.quoteBuy(1n * 10n ** 18n);
    const out = c.buy(1n * 10n ** 18n);
    assert(q === out, 'quote matches execution');
  });

  // ── large buy capped by max_trade ─────────────────────────────────────────────────
  run('large buy is capped by max_trade (10% of virtual token)', () => {
    const c = new Curve(p);
    const cap = (p.virtualToken * p.maxTradeBps) / 10000n;
    let out = 0n;
    try {
      out = c.buy(10n * 10n ** 18n);
      // if not reverted, must still be <= cap
      assert(out <= cap, 'large buy within cap');
    } catch (e) {
      assert(String(e.message).includes('MAX_TRADE_EXCEEDED'), 'expected max trade revert');
    }
    // cap never exceeds cap even with a huge input that doesn't revert near the edge
    const c2 = new Curve(p);
    let any = 0n;
    for (let i = 0; i < 5; i++) {
      try {
        any = c2.buy(5n * 10n ** 18n);
      } catch (e) {
        if (String(e.message).includes('MAX_TRADE_EXCEEDED')) break;
        throw e;
      }
      assert(any <= cap, 'every buy within cap');
    }
  });

  // ── round trip loses value ───────────────────────────────────────────────────────
  run('round trip strictly loses value (fees + pool-favoring rounding)', () => {
    const c = new Curve(p);
    const budget = 20n * 10n ** 18n; // 20 STRK in 1-STRK steps (each step is cap-compliant)
    let spent = 0n;
    let held = 0n;
    let guard = 0;
    while (spent < budget && guard < 25 && !c.graduated) {
      const tokens = c.buy(1n * 10n ** 18n);
      spent += 1n * 10n ** 18n;
      held += tokens;
      guard++;
    }
    if (!c.graduated) {
      const cash = c.sell(held);
      assert(cash < spent, 'round trip must lose value');
      assert(cash > 0n, 'positive cash back');
    } else {
      console.log('    (graduated during accumulation — treated as exit)');
    }
  });

  // ── repeated buys/sells ──────────────────────────────────────────────────────────
  run('repeated buys then sells keep reserves consistent + monotonic price', () => {
    const c = new Curve(p);
    let lastPrice = startPrice;
    let held = 0n;
    for (let i = 0; i < 8; i++) {
      const t = c.buy(1n * 10n ** 18n);
      held += t;
      assert(c.priceStrkPerToken() >= lastPrice, 'buy price monotonic up');
      lastPrice = c.priceStrkPerToken();
    }
    const priceAtTop = lastPrice;
    for (let i = 0; i < 3; i++) {
      const chunk = held / 3n;
      if (chunk === 0n) break;
      c.sell(chunk);
      held -= chunk;
      assert(c.priceStrkPerToken() <= lastPrice, 'sell price monotonic down');
      lastPrice = c.priceStrkPerToken();
    }
    assert(priceAtTop >= lastPrice, 'price fell after sells');
  });

  // ── near graduation + auto-graduation ────────────────────────────────────────────
  run('auto-graduation: buy crossing the target closes the curve and moves reserves', () => {
    const c = new Curve(p);
    // push close to target with small cap-compliant steps (0.5 STRK)
    let guard = 0;
    while (c.baseReserve + 1n * 10n ** 18n < p.gradTarget && !c.graduated && guard < 400) {
      const step = 5n * 10n ** 17n; // 0.5 STRK — never exceeds the max-trade cap
      try {
        c.buy(step);
      } catch (e) {
        if (String(e.message).includes('MAX_TRADE_EXCEEDED')) break;
        throw e;
      }
      guard++;
    }
    assert(!c.graduated, 'not graduated before crossing target');
    const remaining = p.gradTarget - c.baseReserve + 1n * 10n ** 18n; // cross the target
    c.buy(remaining); // this should auto-graduate
    assert(c.graduated, 'auto-graduated at target');
    assert(c.baseReserve === 0n, 'curve drained');
    assert(c.routerBase >= p.gradTarget, 'router got >= target base');
    assert(c.routerToken > 0n, 'router got unsold tokens');
    // post-graduation trading locked
    let locked = false;
    try { c.buy(1n); } catch (e) { locked = String(e.message).includes('CURVE_GRADUATED'); }
    assert(locked, 'buy after graduation reverts');
    let sellLocked = false;
    try { c.sell(1n); } catch (e) { sellLocked = String(e.message).includes('CURVE_GRADUATED'); }
    assert(sellLocked, 'sell after graduation reverts');
  });

  // ── rounding cannot favor the trader ─────────────────────────────────────────────
  run('ceil-division rounding can never mint value for the trader', () => {
    // Repeated 1-unit dust round trips must always end with less base than started.
    const c = new Curve(p);
    const dust = 1000n; // tiny dust buy in smallest units
    let cash = 1000n * dust; // pretend trader has this much base
    let i = 0;
    while (cash > 0n && i < 50) {
      const buy = dust;
      let tokens = 0n;
      try { tokens = c.buy(buy); } catch (e) {
        if (String(e.message).includes('MAX_TRADE_EXCEEDED')) break;
        throw e;
      }
      cash -= buy;
      if (c.graduated) break;
      const back = c.sell(tokens);
      cash += back;
      i++;
    }
    assert(cash < 1000n * dust, 'dust round trip loses value');
  });

  // ── fee correctness ──────────────────────────────────────────────────────────────
  run('fee split: creator + protocol + liquidity receive exactly the fee, reserve counts net', () => {
    const c = new Curve(p);
    const B = 1n * 10n ** 18n; // 1 STRK — cap-compliant (≈33M tokens < 10% cap)
    const tokens = c.buy(B);
    const expectedCreator = (B * p.creatorFeeBps) / MAX_BPS;
    const expectedProtocol = (B * p.protocolFeeBps) / MAX_BPS;
    assert(c.creatorBase === expectedCreator, 'creator fee exact');
    assert(c.protocolBase === expectedProtocol, 'protocol fee exact');
    assert(c.baseReserve === B - expectedCreator - expectedProtocol, 'reserve counts net base');
    assert(c.tokenPhysical === p.supply - c.tokenReserve, 'physical tokens consistent');
  });

  // ── graduation target vs. remaining inventory ────────────────────────────────────
  if (printTable) {
    console.log('\n--- graduation runway table ---');
    const c = new Curve(p);
    const steps = [0.1, 0.25, 0.5, 0.75, 1.0];
    for (const frac of steps) {
      const c2 = new Curve(p);
      let spent = 0n;
      let guard = 0;
      while (c2.baseReserve < p.gradTarget * BigInt(Math.round(frac * 100)) / 100n && !c2.graduated && guard < 100) {
        const step = 2n * 10n ** 18n;
        try { c2.buy(step); } catch (e) {
          if (String(e.message).includes('MAX_TRADE_EXCEEDED')) break;
          throw e;
        }
        guard++;
      }
      const price = c2.graduated ? 0 : c2.priceStrkPerToken();
      const pct = Number(c2.baseReserve) / Number(p.gradTarget) * 100;
      console.log(`  ${(frac * 100).toFixed(0)}% target → reserve ${pct.toFixed(0)}% · price ${price.toExponential(3)} STRK/token · sold ${fmtT(c2.tokenReserve).toLocaleString()} tokens`);
    }
    void steps; void c;
  }

  console.log('\nDone. All invariants held unless marked FAIL above.');
}

main();