/**
 * @file src/ai/schema.ts
 * @description Strict structured proposal schema + validator for Hamster AI.
 *
 * The model returns a proposal as JSON; this module validates it with plain type guards
 * (no schema library) and canonicalizes addresses. A proposal is NEVER an executable
 * transaction — it is an intent statement that the deterministic policy engine and the
 * user must approve before the existing STRK20 stack executes anything.
 *
 * Amounts travel as HUMAN-readable decimal strings at the API boundary; the policy engine
 * parses them exactly into base units. Assets and recipients are canonicalized to lowercase
 * 0x addresses (see src/ai/address.ts).
 */
import { canonicalizeAddress } from '@/ai/address';
import { isZeroAmount } from '@/ai/amount';

export type ProposalActionType = 'private_transfer' | 'report';

export interface ProposalAction {
  type: ProposalActionType;
  /** Canonical token contract address (lowercase 0x). Empty for 'report'. */
  asset: string;
  /** Human-readable decimal amount. Empty for 'report'. */
  amount: string;
  /** Canonical destination address (lowercase 0x). Empty for 'report'. */
  recipient: string;
}

export interface ActionProposal {
  /** Short intent label, e.g. "rebalance". */
  intent: string;
  reason: string;
  action: ProposalAction;
  /** Must be true for any state-changing action; false only for 'report'. */
  requiresUserConfirmation: boolean;
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
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

  // The authoritative policy is always the server-controlled TreasuryPolicy. The model can
  // NEVER influence it: any `constraints` it emits is rejected outright.
  if (r.constraints !== undefined) {
    return { ok: false, error: 'constraints are not accepted; policy is server-controlled' };
  }

  if (!isStr(r.intent) || r.intent.trim() === '') return { ok: false, error: 'intent missing' };
  if (!isStr(r.reason) || r.reason.trim() === '') return { ok: false, error: 'reason missing' };
  if (!isBool(r.requiresUserConfirmation)) return { ok: false, error: 'requiresUserConfirmation missing' };

  const action = r.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') return { ok: false, error: 'action missing' };

  const type = action.type;
  if (type !== 'private_transfer' && type !== 'report') {
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

  if (!isStr(action.asset)) return { ok: false, error: 'action.asset missing' };
  const asset = canonicalizeAddress(action.asset);
  if (!asset.ok) return { ok: false, error: `action.asset: ${asset.error}` };

  if (!isStr(action.amount)) return { ok: false, error: 'action.amount must be a string' };
  if (!/^\d+(\.\d+)?$/.test(action.amount.trim())) {
    return { ok: false, error: 'action.amount must be a plain non-negative decimal' };
  }
  if (isZeroAmount(action.amount)) return { ok: false, error: 'action.amount must be > 0' };

  if (!isStr(action.recipient)) return { ok: false, error: 'action.recipient missing' };
  const recipient = canonicalizeAddress(action.recipient);
  if (!recipient.ok) return { ok: false, error: `action.recipient: ${recipient.error}` };

  if (r.requiresUserConfirmation !== true) {
    return { ok: false, error: 'state-changing actions must require user confirmation' };
  }

  return {
    ok: true,
    value: {
      intent: r.intent.trim(),
      reason: r.reason.trim(),
      action: {
        type,
        asset: asset.value,
        amount: action.amount.trim(),
        recipient: recipient.value,
      },
      requiresUserConfirmation: true,
    },
  };
}