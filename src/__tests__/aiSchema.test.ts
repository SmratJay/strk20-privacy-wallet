import { describe, it, expect } from 'vitest';
import { validateProposal } from '@/ai/schema';

// Valid full-length Starknet addresses (canonical form strips leading zeros).
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const STRK_CANON = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
const DEST_CANON = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

describe('validateProposal', () => {
  it('accepts a valid private_transfer and canonicalizes addresses (mixed-case, leading zeros)', () => {
    const raw = {
      intent: 'rebalance',
      reason: 'Reduce concentration.',
      action: {
        type: 'private_transfer',
        asset: `0X${STRK.slice(2).toUpperCase()}`,
        amount: '150.25',
        recipient: `0X${DEST.slice(2).toUpperCase()}`,
      },
      requiresUserConfirmation: true,
    };
    const r = validateProposal(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.action.asset).toBe(STRK_CANON);
      expect(r.value.action.recipient).toBe(DEST_CANON);
      expect(r.value.action.amount).toBe('150.25');
      expect(r.value.requiresUserConfirmation).toBe(true);
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

  it('rejects model-injected constraints (policy is server-controlled)', () => {
    const r = validateProposal({
      intent: 'transfer',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: DEST },
      constraints: { minLiquidityAfterUsd: 0 }, // attempt to weaken policy
      requiresUserConfirmation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('server-controlled');
  });

  it('rejects unshield (not an executable AI proposal surface)', () => {
    const r = validateProposal({
      intent: 'x',
      reason: 'x',
      action: { type: 'unshield', asset: STRK, amount: '1', recipient: DEST },
      requiresUserConfirmation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unsupported action type');
  });

  it('rejects an actionable proposal that does not require confirmation', () => {
    const r = validateProposal({
      intent: 'transfer',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: DEST },
      requiresUserConfirmation: false,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects short addresses, missing 0x, invalid chars, >64 hex, and zero', () => {
    const base = { intent: 'transfer', reason: 'x', requiresUserConfirmation: true };
    const badAssets = [
      '0x1234', // short
      '0x' + 'a'.repeat(65), // >64 hex
      '0xzzzz', // invalid chars
      '1234', // missing 0x
      '0x0', // zero
    ];
    for (const asset of badAssets) {
      const r = validateProposal({ ...base, action: { type: 'private_transfer', asset, amount: '1', recipient: DEST } });
      expect(r.ok, `asset ${asset.slice(0, 20)} should be rejected`).toBe(false);
    }
    // recipient must also be a real address
    const r = validateProposal({ ...base, action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: '0x1234' } });
    expect(r.ok).toBe(false);
  });

  it('rejects zero, negative, and malformed amounts', () => {
    const base = { intent: 'transfer', reason: 'x', requiresUserConfirmation: true };
    for (const amount of ['0', '0.00', '1e5', '-5', '1.5.5', '.5', '5.']) {
      const r = validateProposal({ ...base, action: { type: 'private_transfer', asset: STRK, amount, recipient: DEST } });
      expect(r.ok, `amount ${JSON.stringify(amount)} should be rejected`).toBe(false);
    }
  });

  it('rejects non-object input', () => {
    expect(validateProposal(null).ok).toBe(false);
    expect(validateProposal('nope').ok).toBe(false);
    expect(validateProposal(42).ok).toBe(false);
  });
});

describe('validateProposal — structured insight (optional, presentation-only)', () => {
  it('accepts an optional insight block on a transfer and preserves it', () => {
    const r = validateProposal({
      intent: 'rebalance',
      reason: 'Reduce concentration.',
      action: { type: 'private_transfer', asset: STRK, amount: '150.25', recipient: DEST },
      requiresUserConfirmation: true,
      insight: {
        diagnosis: 'Your treasury is overly concentrated in STRK.',
        recommendation: 'Move 150 STRK to your approved private reserve.',
        why: 'Reducing STRK exposure closer to your guardrail.',
        outcome: 'Liquidity remains above your guardrail.',
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.insight).toEqual({
        diagnosis: 'Your treasury is overly concentrated in STRK.',
        recommendation: 'Move 150 STRK to your approved private reserve.',
        why: 'Reducing STRK exposure closer to your guardrail.',
        outcome: 'Liquidity remains above your guardrail.',
      });
    }
  });

  it('accepts a report with insight (no execution payload)', () => {
    const r = validateProposal({
      intent: 'report',
      reason: 'Treasury is balanced.',
      action: { type: 'report', asset: '', amount: '', recipient: '' },
      requiresUserConfirmation: false,
      insight: {
        diagnosis: 'Treasury is within guardrails.',
        recommendation: 'No action required.',
        why: 'All metrics are inside policy.',
        outcome: 'Nothing to execute.',
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.action.type).toBe('report');
  });

  it('treats insight as optional — proposals without it still validate', () => {
    const r = validateProposal({
      intent: 'rebalance',
      reason: 'Reduce concentration.',
      action: { type: 'private_transfer', asset: STRK, amount: '150.25', recipient: DEST },
      requiresUserConfirmation: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.insight).toBeUndefined();
  });

  it('rejects an insight missing any required field', () => {
    const base = {
      intent: 'rebalance',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: DEST },
      requiresUserConfirmation: true,
    };
    for (const missing of ['diagnosis', 'recommendation', 'why', 'outcome']) {
      const ins: Record<string, string> = {
        diagnosis: 'a', recommendation: 'b', why: 'c', outcome: 'd',
      };
      delete ins[missing];
      const r = validateProposal({ ...base, insight: ins });
      expect(r.ok, `missing ${missing} should be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toContain(`insight.${missing}`);
    }
  });

  it('rejects a non-object insight', () => {
    const r = validateProposal({
      intent: 'rebalance',
      reason: 'x',
      action: { type: 'private_transfer', asset: STRK, amount: '1', recipient: DEST },
      requiresUserConfirmation: true,
      insight: 'nope',
    });
    expect(r.ok).toBe(false);
  });
});