import { describe, it, expect } from 'vitest';
import { validateProposal } from '@/ai/schema';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

describe('validateProposal', () => {
  it('accepts a valid private_transfer proposal and normalizes addresses', () => {
    const raw = {
      intent: 'rebalance',
      reason: 'Reduce concentration.',
      action: { type: 'private_transfer', asset: `0x${STRK.slice(2).toUpperCase()}`, amount: '150.25', recipient: '0x1234ABCD' },
      constraints: { minLiquidityAfterUsd: 1000, maxPositionPctAfter: 60 },
      requiresUserConfirmation: true,
    };
    const r = validateProposal(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action.asset).toBe(STRK);
      expect(r.value.action.recipient).toBe('0x1234abcd');
      expect(r.value.action.amount).toBe('150.25');
      expect(r.value.constraints?.minLiquidityAfterUsd).toBe(1000);
    }
  });

  it('accepts a report with no execution payload', () => {
    const r = validateProposal({
      intent: 'report',
      reason: 'Treasury is already balanced.',
      action: { type: 'report', asset: '', amount: '', recipient: '' },
      requiresUserConfirmation: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action.type).toBe('report');
      expect(r.value.requiresUserConfirmation).toBe(false);
    }
  });

  it('rejects an actionable proposal that does not require confirmation', () => {
    const r = validateProposal({
      intent: 'transfer',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: '0x1234' },
      requiresUserConfirmation: false,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-positive amount', () => {
    const r = validateProposal({
      intent: 'transfer',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '0', recipient: '0x1234' },
      requiresUserConfirmation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('amount');
  });

  it('rejects malformed asset/recipient addresses', () => {
    const base = { intent: 'transfer', reason: 'x', requiresUserConfirmation: true };
    for (const bad of [
      { type: 'private_transfer', asset: 'not-an-address', amount: '1', recipient: '0x1234' },
      { type: 'private_transfer', asset: STRK, amount: '1', recipient: '0x0' },
      { type: 'private_transfer', asset: STRK, amount: '1', recipient: 'no-prefix' },
    ]) {
      const r = validateProposal({ ...base, action: bad });
      expect(r.ok).toBe(false);
    }
  });

  it('rejects unsupported action types', () => {
    const r = validateProposal({
      intent: 'x',
      reason: 'x',
      action: { type: 'mint_money', asset: STRK, amount: '1', recipient: '0x1234' },
      requiresUserConfirmation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unsupported action type');
  });

  it('rejects non-object input', () => {
    expect(validateProposal(null).ok).toBe(false);
    expect(validateProposal('nope').ok).toBe(false);
    expect(validateProposal(42).ok).toBe(false);
  });
});