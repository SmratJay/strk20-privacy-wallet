/**
 * @file src/ai/schema.ts
 * @description Strict structured proposal schema + validator for Hamster AI.
 *
 * The model returns a proposal as JSON; this module validates it with plain type guards
 * (no schema library) and normalizes it. A proposal is NEVER an executable transaction — it
 * is an intent statement that the deterministic policy engine and the user must approve
 * before the existing STRK20 stack executes anything.
 *
 * Amounts travel as HUMAN-readable decimal strings (e.g. "150.25"); the policy engine
 * converts to base units using the asset's on-chain decimals. Assets and recipients are
 * lowercase 0x addresses.
 */
export type ProposalActionType = 'private_transfer' | 'unshield' | 'report';

export interface ProposalAction {
  type: ProposalActionType;
  /** Token contract address (lowercase 0x). Empty for 'report'. */
  asset: string;
  /** Human-readable decimal amount. Empty for 'report'. */
  amount: string;
  /** Destination address (lowercase 0x). Empty for 'report'. */
  recipient: string;
}

export interface ProposalConstraints {
  /** USD liquidity that must remain after the action. */
  minLiquidityAfterUsd?: number;
  /** Max single-asset allocation (%) after the action. */
  maxPositionPctAfter?: number;
}

export interface ActionProposal {
  /** Short intent label, e.g. "rebalance". */
  intent: string;
  reason: string;
  action: ProposalAction;
  constraints?: ProposalConstraints;
  /** Must be true for any state-changing action; false only for 'report'. */
  requiresUserConfirmation: boolean;
}

const HEX_ADDR = /^0x[0-9a-fA-F]{1,64}$/;
const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/;

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function normalizeAddr(v: string): string {
  return v.toLowerCase();
}

/**
 * Validate an unknown JSON value against the proposal schema.
 * Returns a discriminated result so callers never receive a partial proposal.
 */
export function validateProposal(
  raw: unknown,
): { ok: true; value: ActionProposal } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'proposal must be an object' };
  }
  const r = raw as Record<string, unknown>;

  if (!isStr(r.intent) || r.intent.trim() === '') return { ok: false, error: 'intent missing' };
  if (!isStr(r.reason) || r.reason.trim() === '') return { ok: false, error: 'reason missing' };
  if (!isBool(r.requiresUserConfirmation)) return { ok: false, error: 'requiresUserConfirmation missing' };

  const action = r.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') return { ok: false, error: 'action missing' };

  const type = action.type;
  if (type !== 'private_transfer' && type !== 'unshield' && type !== 'report') {
    return { ok: false, error: `unsupported action type: ${String(type)}` };
  }

  if (type === 'report') {
    // A report has no execution payload and never needs confirmation.
    return {
      ok: true,
      value: {
        intent: r.intent.trim(),
        reason: r.reason.trim(),
        action: { type, asset: '', amount: '', recipient: '' },
        requiresUserConfirmation: false,
      },
    };
  }

  if (!isStr(action.asset) || !HEX_ADDR.test(action.asset)) {
    return { ok: false, error: 'action.asset must be a 0x address' };
  }
  if (!isStr(action.amount) || !DECIMAL_AMOUNT.test(action.amount)) {
    return { ok: false, error: 'action.amount must be a positive decimal string' };
  }
  const amountNum = Number(action.amount);
  if (amountNum <= 0) return { ok: false, error: 'action.amount must be > 0' };
  if (!isStr(action.recipient) || !HEX_ADDR.test(action.recipient)) {
    return { ok: false, error: 'action.recipient must be a 0x address' };
  }
  if (action.recipient.toLowerCase() === '0x0') {
    return { ok: false, error: 'action.recipient must be non-zero' };
  }
  if (r.requiresUserConfirmation !== true) {
    return { ok: false, error: 'state-changing actions must require user confirmation' };
  }

  let constraints: ProposalConstraints | undefined;
  if (r.constraints !== undefined) {
    if (r.constraints === null || typeof r.constraints !== 'object') {
      return { ok: false, error: 'constraints must be an object' };
    }
    const c = r.constraints as Record<string, unknown>;
    constraints = {};
    if (c.minLiquidityAfterUsd !== undefined) {
      if (!isNum(c.minLiquidityAfterUsd) || c.minLiquidityAfterUsd < 0) {
        return { ok: false, error: 'minLiquidityAfterUsd must be a non-negative number' };
      }
      constraints.minLiquidityAfterUsd = c.minLiquidityAfterUsd;
    }
    if (c.maxPositionPctAfter !== undefined) {
      if (!isNum(c.maxPositionPctAfter) || c.maxPositionPctAfter <= 0 || c.maxPositionPctAfter > 100) {
        return { ok: false, error: 'maxPositionPctAfter must be in (0, 100]' };
      }
      constraints.maxPositionPctAfter = c.maxPositionPctAfter;
    }
  }

  return {
    ok: true,
    value: {
      intent: r.intent.trim(),
      reason: r.reason.trim(),
      action: {
        type,
        asset: normalizeAddr(action.asset),
        amount: action.amount,
        recipient: normalizeAddr(action.recipient),
      },
      constraints,
      requiresUserConfirmation: true,
    },
  };
}