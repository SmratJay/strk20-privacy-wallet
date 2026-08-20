/**
 * @file tests/integration/fullContractIntegration.test.ts
 * @description Full PEL BTC-PERP Golden Path & Contract Integration Test Suite (Blueprint Section 16 & 23)
 *
 * Simulates high-fidelity execution of:
 * - Golden Path: Mint USDC -> Approve -> Register OPEN Fact -> Core.open_position -> UPDATE -> FUND (+/-) -> CLOSE -> CLAIM
 * - Liquidation Path: OPEN -> Adverse Price -> Keeper Solvency Eval -> Register LIQ Fact -> Core.liquidate_position -> Bounty Claim
 * - LP Counterparty Dynamics: Deposit -> Trader PnL -> Reserve Protection -> Safe Withdrawal
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { zkProverService } from '../../src/services/zkProverService';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  calcNotionalCents,
  isLiquidatable,
  usdToCents,
  tokensToSats,
} from '../../src/protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../../src/protocol/types';

// High-fidelity Mock of the Complete PEL Contract Stack (Core + Verifier + STRK20Adapter + Oracle + ERC20)
class MockContractStack {
  public tokenBalances: Map<string, bigint> = new Map(); // address -> base units (cents * 10,000)
  public tokenAllowances: Map<string, Map<string, bigint>> = new Map();
  public verifiedFacts: Map<string, boolean> = new Map();
  public usedNullifiers: Set<string> = new Set();
  public commitmentByNullifier: Map<string, string> = new Map();
  public positions: Map<string, { commitment: string; nullifier: string; lockedMargin: bigint; isActive: boolean }> = new Map();
  public payoutNotes: Map<string, { recipient: string; amount: bigint; isClaimed: boolean }> = new Map();
  public keeperBounties: Map<string, bigint> = new Map();
  public lpShares: Map<string, bigint> = new Map();

  public totalLockedMargin: bigint = 0n;
  public lpPoolNav: bigint = 0n;
  public totalLpShares: bigint = 0n;
  public insuranceFund: bigint = 0n;
  public unclaimedPayoutsTotal: bigint = 0n;
  public unclaimedBountiesTotal: bigint = 0n;

  // ERC20 Operations
  mint(account: string, amountCents: bigint) {
    const units = amountCents * 10_000n;
    const cur = this.tokenBalances.get(account.toLowerCase()) || 0n;
    this.tokenBalances.set(account.toLowerCase(), cur + units);
  }

  approve(owner: string, spender: string, amountCents: bigint) {
    const units = amountCents * 10_000n;
    let spenderMap = this.tokenAllowances.get(owner.toLowerCase());
    if (!spenderMap) {
      spenderMap = new Map();
      this.tokenAllowances.set(owner.toLowerCase(), spenderMap);
    }
    spenderMap.set(spender.toLowerCase(), units);
  }

  // StwoVerifier Fact Registration
  registerFact(factHash: string) {
    this.verifiedFacts.set(factHash.toLowerCase(), true);
  }

  // Core Open Position
  openPosition(
    collateralOwner: string,
    marketId: string,
    commitment: string,
    marginNullifier: string,
    positionNullifier: string,
    marginAmountCents: bigint,
    oraclePriceCents: bigint,
    factHash: string
  ) {
    if (this.usedNullifiers.has(marginNullifier)) throw new Error('MARGIN_NULLIFIER_ALREADY_SPENT');
    if (!this.verifiedFacts.get(factHash.toLowerCase())) throw new Error('INVALID_OPEN_FACT');

    const expectedFact = zkProverService.computeOpenFactHash(
      marketId, commitment, marginNullifier, marginAmountCents, oraclePriceCents, collateralOwner
    );
    if (factHash.toLowerCase() !== expectedFact.toLowerCase()) throw new Error('FACT_HASH_MISMATCH');

    // Transfer ERC20 margin from user to adapter
    const units = marginAmountCents * 10_000n;
    const userBal = this.tokenBalances.get(collateralOwner.toLowerCase()) || 0n;
    if (userBal < units) throw new Error('INSUFFICIENT_TOKEN_BALANCE');
    this.tokenBalances.set(collateralOwner.toLowerCase(), userBal - units);

    this.usedNullifiers.add(marginNullifier);
    this.commitmentByNullifier.set(positionNullifier, commitment);
    this.positions.set(commitment, {
      commitment,
      nullifier: positionNullifier,
      lockedMargin: marginAmountCents,
      isActive: true,
    });
    this.totalLockedMargin += marginAmountCents;
  }

  // Core Update Position
  updatePosition(
    marketId: string,
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    newNullifier: string,
    oraclePriceCents: bigint,
    factHash: string
  ) {
    const pos = this.positions.get(oldCommitment);
    if (!pos || !pos.isActive) throw new Error('POSITION_NOT_ACTIVE');
    if (this.usedNullifiers.has(oldNullifier)) throw new Error('OLD_NULLIFIER_ALREADY_SPENT');
    if (this.commitmentByNullifier.get(oldNullifier) !== oldCommitment) throw new Error('NULLIFIER_COMMITMENT_MISMATCH');

    const expectedFact = zkProverService.computeUpdateFactHash(
      marketId, oldCommitment, oldNullifier, newCommitment, pos.lockedMargin, oraclePriceCents
    );
    if (factHash.toLowerCase() !== expectedFact.toLowerCase()) throw new Error('FACT_HASH_MISMATCH');
    if (!this.verifiedFacts.get(factHash.toLowerCase())) throw new Error('INVALID_UPDATE_FACT');

    pos.isActive = false;
    this.usedNullifiers.add(oldNullifier);

    this.positions.set(newCommitment, {
      commitment: newCommitment,
      nullifier: newNullifier,
      lockedMargin: pos.lockedMargin,
      isActive: true,
    });
    this.commitmentByNullifier.set(newNullifier, newCommitment);
  }

  // Core Fund Position (Bidirectional)
  fundPosition(
    marketId: string,
    commitment: string,
    oldNullifier: string,
    newCommitment: string,
    newNullifier: string,
    fundingAmountCents: bigint,
    isLongPays: boolean,
    oraclePriceCents: bigint,
    factHash: string
  ) {
    const pos = this.positions.get(commitment);
    if (!pos || !pos.isActive) throw new Error('POSITION_NOT_ACTIVE');
    if (this.usedNullifiers.has(oldNullifier)) throw new Error('OLD_NULLIFIER_ALREADY_SPENT');
    if (this.commitmentByNullifier.get(oldNullifier) !== commitment) throw new Error('NULLIFIER_COMMITMENT_MISMATCH');

    const newMargin = isLongPays ? pos.lockedMargin - fundingAmountCents : pos.lockedMargin + fundingAmountCents;
    const expectedFact = zkProverService.computeFundFactHash(
      marketId, commitment, oldNullifier, newCommitment, fundingAmountCents, newMargin, oraclePriceCents, isLongPays
    );
    if (factHash.toLowerCase() !== expectedFact.toLowerCase()) throw new Error('FACT_HASH_MISMATCH');
    if (!this.verifiedFacts.get(factHash.toLowerCase())) throw new Error('INVALID_FUND_FACT');

    pos.isActive = false;
    this.usedNullifiers.add(oldNullifier);

    this.positions.set(newCommitment, {
      commitment: newCommitment,
      nullifier: newNullifier,
      lockedMargin: newMargin,
      isActive: true,
    });
    this.commitmentByNullifier.set(newNullifier, newCommitment);

    // Reconcile LP NAV and locked margin
    if (isLongPays) {
      this.totalLockedMargin -= fundingAmountCents;
      this.lpPoolNav += fundingAmountCents;
    } else {
      this.totalLockedMargin += fundingAmountCents;
      this.lpPoolNav -= fundingAmountCents;
    }
  }

  // Core Close Position
  closePosition(
    marketId: string,
    positionCommitment: string,
    finalNullifier: string,
    payoutCommitment: string,
    payoutAmountCents: bigint,
    oraclePriceCents: bigint,
    recipient: string,
    factHash: string
  ) {
    const pos = this.positions.get(positionCommitment);
    if (!pos || !pos.isActive) throw new Error('POSITION_NOT_ACTIVE');
    if (this.usedNullifiers.has(finalNullifier)) throw new Error('FINAL_NULLIFIER_ALREADY_SPENT');
    if (this.commitmentByNullifier.get(finalNullifier) !== positionCommitment) throw new Error('NULLIFIER_COMMITMENT_MISMATCH');

    const expectedFact = zkProverService.computeCloseFactHash(
      marketId, positionCommitment, finalNullifier, payoutCommitment, payoutAmountCents, oraclePriceCents, recipient
    );
    if (factHash.toLowerCase() !== expectedFact.toLowerCase()) throw new Error('FACT_HASH_MISMATCH');
    if (!this.verifiedFacts.get(factHash.toLowerCase())) throw new Error('INVALID_CLOSE_FACT');

    pos.isActive = false;
    this.usedNullifiers.add(finalNullifier);

    // Accounting deltas
    const profit = payoutAmountCents > pos.lockedMargin ? payoutAmountCents - pos.lockedMargin : 0n;
    const loss = pos.lockedMargin > payoutAmountCents ? pos.lockedMargin - payoutAmountCents : 0n;

    this.totalLockedMargin -= pos.lockedMargin;
    if (profit > 0n) {
      this.lpPoolNav -= profit;
    }
    if (loss > 0n) {
      this.lpPoolNav += loss;
    }

    this.unclaimedPayoutsTotal += payoutAmountCents;
    this.payoutNotes.set(payoutCommitment, {
      recipient: recipient.toLowerCase(),
      amount: payoutAmountCents,
      isClaimed: false,
    });
  }

  // Claim Payout
  claimPayout(payoutCommitment: string, recipient: string) {
    const note = this.payoutNotes.get(payoutCommitment);
    if (!note) throw new Error('NOTE_NOT_FOUND');
    if (note.isClaimed) throw new Error('NOTE_ALREADY_CLAIMED');
    if (note.recipient !== recipient.toLowerCase()) throw new Error('UNAUTHORIZED_RECIPIENT');

    note.isClaimed = true;
    this.unclaimedPayoutsTotal -= note.amount;

    const units = note.amount * 10_000n;
    const cur = this.tokenBalances.get(recipient.toLowerCase()) || 0n;
    this.tokenBalances.set(recipient.toLowerCase(), cur + units);
  }

  // Core Liquidate Position
  liquidatePosition(
    marketId: string,
    positionCommitment: string,
    positionNullifier: string,
    oraclePriceCents: bigint,
    keeperRecipient: string,
    factHash: string
  ) {
    const pos = this.positions.get(positionCommitment);
    if (!pos || !pos.isActive) throw new Error('POSITION_NOT_ACTIVE');
    if (this.usedNullifiers.has(positionNullifier)) throw new Error('NULLIFIER_ALREADY_SPENT');
    if (this.commitmentByNullifier.get(positionNullifier) !== positionCommitment) throw new Error('NULLIFIER_COMMITMENT_MISMATCH');

    const expectedFact = zkProverService.computeLiquidateFactHash(
      marketId, positionCommitment, positionNullifier, pos.lockedMargin, oraclePriceCents, keeperRecipient
    );
    if (factHash.toLowerCase() !== expectedFact.toLowerCase()) throw new Error('FACT_HASH_MISMATCH');
    if (!this.verifiedFacts.get(factHash.toLowerCase())) throw new Error('INVALID_LIQUIDATE_FACT');

    pos.isActive = false;
    this.usedNullifiers.add(positionNullifier);

    const total = pos.lockedMargin;
    const bounty = (total * 200n) / 10000n;
    const insurancePart = total - bounty;

    this.totalLockedMargin -= total;
    this.insuranceFund += insurancePart;
    this.unclaimedBountiesTotal += bounty;

    const curBounty = this.keeperBounties.get(keeperRecipient.toLowerCase()) || 0n;
    this.keeperBounties.set(keeperRecipient.toLowerCase(), curBounty + bounty);
  }

  claimKeeperBounty(keeper: string) {
    const bounty = this.keeperBounties.get(keeper.toLowerCase()) || 0n;
    if (bounty <= 0n) throw new Error('NO_BOUNTY_AVAILABLE');

    this.keeperBounties.set(keeper.toLowerCase(), 0n);
    this.unclaimedBountiesTotal -= bounty;

    const units = bounty * 10_000n;
    const cur = this.tokenBalances.get(keeper.toLowerCase()) || 0n;
    this.tokenBalances.set(keeper.toLowerCase(), cur + units);
  }

  // LP Liquidity Pool Operations
  depositLiquidity(provider: string, amountCents: bigint): bigint {
    const units = amountCents * 10_000n;
    const userBal = this.tokenBalances.get(provider.toLowerCase()) || 0n;
    if (userBal < units) throw new Error('INSUFFICIENT_TOKEN_BALANCE');
    this.tokenBalances.set(provider.toLowerCase(), userBal - units);

    const sharesToMint = this.totalLpShares === 0n || this.lpPoolNav === 0n
      ? amountCents * 1000n
      : (amountCents * this.totalLpShares) / this.lpPoolNav;

    const curShares = this.lpShares.get(provider.toLowerCase()) || 0n;
    this.lpShares.set(provider.toLowerCase(), curShares + sharesToMint);
    this.totalLpShares += sharesToMint;
    this.lpPoolNav += amountCents;

    return sharesToMint;
  }

  withdrawLiquidity(provider: string, shares: bigint): bigint {
    const userShares = this.lpShares.get(provider.toLowerCase()) || 0n;
    if (userShares < shares) throw new Error('INSUFFICIENT_LP_SHARES');

    const payoutCents = (shares * this.lpPoolNav) / this.totalLpShares;
    const requiredReserve = (this.totalLockedMargin * 5000n) / 10000n;
    const withdrawableNav = this.lpPoolNav > requiredReserve ? this.lpPoolNav - requiredReserve : 0n;

    if (payoutCents > withdrawableNav) throw new Error('EXCEEDS_WITHDRAWABLE_NAV');

    this.lpShares.set(provider.toLowerCase(), userShares - shares);
    this.totalLpShares -= shares;
    this.lpPoolNav -= payoutCents;

    const units = payoutCents * 10_000n;
    const cur = this.tokenBalances.get(provider.toLowerCase()) || 0n;
    this.tokenBalances.set(provider.toLowerCase(), cur + units);

    return payoutCents;
  }

  getSolvencySnapshot() {
    const internalSum = this.totalLockedMargin + this.lpPoolNav + this.insuranceFund + this.unclaimedPayoutsTotal + this.unclaimedBountiesTotal;
    return {
      lockedMargin: this.totalLockedMargin,
      lpNav: this.lpPoolNav,
      insurance: this.insuranceFund,
      unclaimedPayouts: this.unclaimedPayoutsTotal,
      unclaimedBounties: this.unclaimedBountiesTotal,
      internalSum,
    };
  }
}

describe('PEL BTC-PERP Complete Contract Integration & Golden Path', () => {
  let stack: MockContractStack;
  const user = '0x0111111111111111111111111111111111111111';
  const lpProvider = '0x0222222222222222222222222222222222222222';
  const keeper = '0x0333333333333333333333333333333333333333';
  const ownerSecret = '0x1234567890abcdef1234567890abcdef';
  const nonce0 = '0x0001';

  beforeEach(() => {
    stack = new MockContractStack();
    // Seed initial balances: User gets $5,000, LP gets $50,000
    stack.mint(user, 500_000n);
    stack.mint(lpProvider, 5_000_000n);

    // LP Seeds pool with $20,000
    stack.depositLiquidity(lpProvider, 2_000_000n);
  });

  it('Flow 1 (Golden Path): OPEN -> Assert State -> UPDATE -> FUND(+) -> FUND(-) -> CLOSE -> CLAIM', () => {
    const oracleOpenPriceCents = 95_000_00n; // $95,000.00
    const marginCents = 100_000n; // $1,000.00
    const qtySats = 10_526_315n; // ~0.1052 BTC (~10x leverage)
    const marginNoteNullifier = '0x0a1b2c3d4e5f00000000000000000001';

    const c0 = zkProverService.computePositionCommitment(
      ownerSecret, 'BTC-PERP', 'LONG', qtySats, oracleOpenPriceCents, marginCents, 0n, nonce0
    );
    const nf0 = zkProverService.computeNullifier(ownerSecret, c0);

    const openFact = zkProverService.computeOpenFactHash(
      'BTC-PERP', c0, marginNoteNullifier, marginCents, oracleOpenPriceCents, user
    );

    // 1. Register & Open
    stack.registerFact(openFact);
    stack.openPosition(user, 'BTC-PERP', c0, marginNoteNullifier, nf0, marginCents, oracleOpenPriceCents, openFact);

    expect(stack.positions.get(c0)?.isActive).toBe(true);
    expect(stack.totalLockedMargin).toBe(marginCents);

    // 2. UPDATE Position on price tick to $96,000
    const oracleUpdatePriceCents = 96_000_00n;
    const nonce1 = '0x0002';
    const c1 = zkProverService.computePositionCommitment(
      ownerSecret, 'BTC-PERP', 'LONG', qtySats, oracleOpenPriceCents, marginCents, 0n, nonce1
    );
    const nf1 = zkProverService.computeNullifier(ownerSecret, c1);
    const updateFact = zkProverService.computeUpdateFactHash(
      'BTC-PERP', c0, nf0, c1, marginCents, oracleUpdatePriceCents
    );

    stack.registerFact(updateFact);
    stack.updatePosition('BTC-PERP', c0, nf0, c1, nf1, oracleUpdatePriceCents, updateFact);

    expect(stack.positions.get(c0)?.isActive).toBe(false);
    expect(stack.positions.get(c1)?.isActive).toBe(true);

    // 3. FUND Position (trader pays 1 hour funding = $12.00 = 1,200 cents)
    const fundingAmountCents = 1_200n;
    const nonce2 = '0x0003';
    const c2 = zkProverService.computePositionCommitment(
      ownerSecret, 'BTC-PERP', 'LONG', qtySats, oracleOpenPriceCents, marginCents - fundingAmountCents, fundingAmountCents, nonce2
    );
    const nf2 = zkProverService.computeNullifier(ownerSecret, c2);
    const fundFact = zkProverService.computeFundFactHash(
      'BTC-PERP', c1, nf1, c2, fundingAmountCents, marginCents - fundingAmountCents, oracleUpdatePriceCents, true
    );

    stack.registerFact(fundFact);
    stack.fundPosition('BTC-PERP', c1, nf1, c2, nf2, fundingAmountCents, true, oracleUpdatePriceCents, fundFact);

    expect(stack.positions.get(c2)?.lockedMargin).toBe(marginCents - fundingAmountCents);

    // 4. CLOSE Position at $100,000 with profit!
    // PnL = qty * (100k - 95k) = 0.10526315 * 5000 = +$526.31 = +52,631 cents
    // Equity = (100,000 - 1,200) + 52,631 = 151,431 cents ($1,514.31)
    const oracleClosePriceCents = 100_000_00n;
    const pnlCents = calcPnlCents('LONG', qtySats, oracleOpenPriceCents, oracleClosePriceCents);
    const payoutCents = calcEquityCents(marginCents - fundingAmountCents, pnlCents, 0n, 0n);

    const payoutNoteCommitment = '0xaaaabbbbccccdddd1111222233334444';
    const closeFact = zkProverService.computeCloseFactHash(
      'BTC-PERP', c2, nf2, payoutNoteCommitment, payoutCents, oracleClosePriceCents, user
    );

    stack.registerFact(closeFact);
    stack.closePosition(
      'BTC-PERP', c2, nf2, payoutNoteCommitment, payoutCents, oracleClosePriceCents, user, closeFact
    );

    expect(stack.positions.get(c2)?.isActive).toBe(false);
    expect(stack.unclaimedPayoutsTotal).toBe(payoutCents);

    // 5. CLAIM Payout Note into ERC20 balance
    const userBalBeforeClaim = stack.tokenBalances.get(user.toLowerCase()) || 0n;
    stack.claimPayout(payoutNoteCommitment, user);
    const userBalAfterClaim = stack.tokenBalances.get(user.toLowerCase()) || 0n;

    expect(userBalAfterClaim - userBalBeforeClaim).toBe(payoutCents * 10_000n);
    expect(stack.unclaimedPayoutsTotal).toBe(0n);
  });

  it('Flow 2 (Liquidation Path): OPEN -> Adverse Price Drop -> Keeper Solvency Eval -> LIQUIDATE -> Bounty Claim', () => {
    const oracleOpenPriceCents = 95_000_00n;
    const marginCents = 50_000n; // $500.00
    const qtySats = 13_157_894n; // ~25x leverage
    const marginNoteNullifier = '0x0a1b2c3d4e5f00000000000000000002';

    const c0 = zkProverService.computePositionCommitment(
      ownerSecret, 'BTC-PERP', 'LONG', qtySats, oracleOpenPriceCents, marginCents, 0n, nonce0
    );
    const nf0 = zkProverService.computeNullifier(ownerSecret, c0);

    const openFact = zkProverService.computeOpenFactHash(
      'BTC-PERP', c0, marginNoteNullifier, marginCents, oracleOpenPriceCents, user
    );

    stack.registerFact(openFact);
    stack.openPosition(user, 'BTC-PERP', c0, marginNoteNullifier, nf0, marginCents, oracleOpenPriceCents, openFact);

    // Price crashes 5% to $90,250.00 -> Equity <= Maintenance Margin!
    const crashPriceCents = 90_250_00n;
    const pnlCents = calcPnlCents('LONG', qtySats, oracleOpenPriceCents, crashPriceCents);
    const equityCents = calcEquityCents(marginCents, pnlCents, 0n, 0n);
    const maintMarginCents = calcMaintMarginCents(qtySats, crashPriceCents, 200n);

    expect(isLiquidatable(equityCents, maintMarginCents)).toBe(true);

    const liqFact = zkProverService.computeLiquidateFactHash(
      'BTC-PERP', c0, nf0, marginCents, crashPriceCents, keeper
    );

    stack.registerFact(liqFact);
    stack.liquidatePosition('BTC-PERP', c0, nf0, crashPriceCents, keeper, liqFact);

    expect(stack.positions.get(c0)?.isActive).toBe(false);
    expect(stack.insuranceFund).toBe((marginCents * 9800n) / 10000n); // 98%
    expect(stack.unclaimedBountiesTotal).toBe((marginCents * 200n) / 10000n); // 2%

    // Keeper claims bounty
    const keeperBalBefore = stack.tokenBalances.get(keeper.toLowerCase()) || 0n;
    stack.claimKeeperBounty(keeper);
    const keeperBalAfter = stack.tokenBalances.get(keeper.toLowerCase()) || 0n;

    expect(keeperBalAfter - keeperBalBefore).toBe(((marginCents * 200n) / 10000n) * 10_000n);
  });

  it('Flow 3 (LP Reserve Protection): LP cannot drain funds below counterparty risk reserve', () => {
    // Active open positions create required counterparty reserve
    const marginCents = 100_000n;
    const c0 = '0x_active_pos_1';
    const nf0 = '0x_nf_1';
    stack.positions.set(c0, { commitment: c0, nullifier: nf0, lockedMargin: marginCents, isActive: true });
    stack.totalLockedMargin = marginCents; // $1,000 locked margin -> $500 required reserve

    const totalLpShares = stack.totalLpShares; // All shares
    // Attempting to withdraw 100% of shares when reserve is required must fail
    expect(() => {
      stack.withdrawLiquidity(lpProvider, totalLpShares);
    }).toThrow('EXCEEDS_WITHDRAWABLE_NAV');
  });
});
