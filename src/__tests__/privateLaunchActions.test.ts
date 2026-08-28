import { describe, it, expect } from 'vitest';
import {
  buildPrivateBuyActions,
  buildPrivateSellActions,
  CURVE_OP,
} from '@/services/privateLaunchService';

const plan = {
  operation: CURVE_OP.BUY,
  inputToken: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', // STRK
  outputToken: '0x1234',
  amount: '5000000000000000000',
  executor: '0xabc',
  userAddress: '0xuser',
};

describe('buildPrivateBuyActions', () => {
  it('builds the three ordered STRK20 actions', () => {
    const actions = buildPrivateBuyActions(plan);
    expect(actions.length).toBe(3);

    // 1. withdraw STRK to the executor
    expect(actions[0]).toEqual({
      type: 'withdraw',
      token: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      amount: '0x' + (5000000000000000000n).toString(16),
      recipient: '0xabc',
    });

    // 2. open HAMSTR note for the user
    expect(actions[1]).toEqual({
      type: 'transfer',
      token: '0x1234',
      amount: 'OPEN',
      recipient: '0xuser',
    });

    // 3. invoke the executor with the open-note placeholder
    expect(actions[2]).toMatchObject({
      type: 'invoke',
      contract: '0xabc',
    });
    const invoke = actions[2] as { calldata: (string | number)[] };
    expect(invoke.calldata).toEqual([
      CURVE_OP.BUY,
      '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      '0x' + (5000000000000000000n).toString(16),
      '${openNoteIds[0]}',
    ]);
  });
});

describe('buildPrivateSellActions', () => {
  it('builds withdraw(memecoin→executor) + open STRK note + invoke(SELL)', () => {
    const actions = buildPrivateSellActions({
      ...plan,
      operation: CURVE_OP.SELL,
      inputToken: plan.outputToken,
      outputToken: plan.inputToken,
    });
    expect(actions.length).toBe(3);
    expect(actions[0]).toMatchObject({ type: 'withdraw', token: '0x1234', recipient: '0xabc' });
    expect(actions[1]).toEqual({ type: 'transfer', token: plan.inputToken, amount: 'OPEN', recipient: '0xuser' });
    const invoke = actions[2] as { calldata: (string | number)[] };
    expect(invoke.calldata).toEqual([CURVE_OP.SELL, '0x1234', expect.any(String), '${openNoteIds[0]}']);
  });
});

describe('placeholders', () => {
  it('uses exactly one open-note placeholder so the wallet can resolve it', () => {
    const buy = buildPrivateBuyActions(plan);
    const sell = buildPrivateSellActions({ ...plan, operation: CURVE_OP.SELL, inputToken: plan.outputToken, outputToken: plan.inputToken });
    for (const actions of [buy, sell]) {
      const invoke = actions[2] as { calldata: (string | number)[] };
      expect(invoke.calldata.filter((c) => typeof c === 'string' && c.includes('${openNoteIds'))).toHaveLength(1);
      // one OPEN transfer per invoke action (matches the pool's open-note accounting)
      expect(actions.filter((a) => a.type === 'transfer' && a.amount === 'OPEN')).toHaveLength(1);
    }
  });
});