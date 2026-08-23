/**
 * @file strk20WalletApiOnboarding.test.ts
 * @description Unit tests for the LANE A private-receiving onboarding flow. Readiness is
 * protocol-derived (wallet_strk20Balances → NOT_REGISTERED), never a local flag or an
 * error-string guess. enablePrivateReceiving must only ever submit a real
 * wallet_strk20InvokeTransaction when the wallet itself reports NEEDS_REGISTRATION.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getPrivateReceivingRequirement,
  enablePrivateReceiving,
  MIN_STRK20_WALLET_API_VERSION,
  SN_SEPOLIA_CHAIN_ID,
} from '../services/strk20WalletApiService';

type RegistrationState = 'registered' | 'not_registered' | 'error';
type InvokeMode = 'success' | 'reject' | 'finalizing' | 'not_registered_invoke';

interface WalletOptions {
  connected?: boolean;
  supportsStrk20?: boolean;
  chainId?: string;
  registration?: RegistrationState;
  invokeMode?: InvokeMode;
  /** Registration state after a successful invoke (default: 'registered'). */
  postInvokeRegistration?: RegistrationState;
}

function walletWithCode(message: string, code: number): Error & { code: number } {
  const err: any = new Error(message);
  err.code = code;
  return err;
}

/**
 * A scripted Wallet API provider. Records every wallet_strk20InvokeTransaction so tests
 * can assert "no transaction sent when already ready" and the exact deposit action.
 */
function makeWallet(opts: WalletOptions = {}) {
  const {
    connected = true,
    supportsStrk20 = true,
    chainId = SN_SEPOLIA_CHAIN_ID,
    registration = 'registered',
    invokeMode = 'success',
    postInvokeRegistration = 'registered',
  } = opts;

  const invokeCalls: any[] = [];
  // A successful wallet_strk20InvokeTransaction auto-registers the user (this is exactly
  // what the wallet's autoRegister prover does), so a later balances probe succeeds.
  let registrationState = registration;

  const request = async ({ type, params }: any): Promise<unknown> => {
    switch (type) {
      case 'wallet_supportedWalletApi':
        return supportsStrk20 ? [MIN_STRK20_WALLET_API_VERSION] : ['0.9.0'];
      case 'wallet_supportedSpecs':
        return supportsStrk20 ? [MIN_STRK20_WALLET_API_VERSION] : [];
      case 'wallet_requestChainId':
        return chainId;
      case 'wallet_strk20Balances':
        if (registrationState === 'not_registered') {
          throw walletWithCode('An error occurred (NOT_REGISTERED)', 118);
        }
        if (registrationState === 'error') {
          throw walletWithCode('An error occurred (UNKNOWN_ERROR)', 163);
        }
        return [{ token: '0x1', balance: '0x0' }];
      case 'wallet_strk20InvokeTransaction': {
        invokeCalls.push(params?.actions);
        if (invokeMode === 'reject') throw walletWithCode('An error occurred (USER_REFUSED_OP)', 113);
        if (invokeMode === 'finalizing') {
          throw new Error('Account is not finalized yet — cannot prove the registration');
        }
        if (invokeMode === 'not_registered_invoke') {
          // Wallet could not transparently register on the deposit (finality).
          throw walletWithCode('An error occurred (NOT_REGISTERED)', 118);
        }
        registrationState = postInvokeRegistration;
        return { transaction_hash: '0x0abcdef123456789' };
      }
      default:
        return [];
    }
  };

  return {
    wallet: {
      isConnected: connected,
      rawWallet: { request },
    },
    invokeCalls,
    request,
  };
}

const TOKEN = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const AMOUNT = 10_000_000n; // 10 USDC (6 decimals)

const reconcileConfirmed = vi.fn(async () => 'CONFIRMED' as const);
const reconcilePending = vi.fn(async () => 'PENDING' as const);
const reconcileReverted = vi.fn(async () => 'REVERTED' as const);

describe('getPrivateReceivingRequirement (protocol-derived readiness)', () => {
  it('returns CONNECT_WALLET when no wallet is connected', async () => {
    expect(await getPrivateReceivingRequirement(makeWallet({ connected: false }).wallet)).toBe('CONNECT_WALLET');
  });

  it('returns UNSUPPORTED for a non-privacy wallet', async () => {
    expect(await getPrivateReceivingRequirement(makeWallet({ supportsStrk20: false }).wallet)).toBe('UNSUPPORTED');
  });

  it('returns WRONG_NETWORK for a non-Sepolia chain', async () => {
    expect(await getPrivateReceivingRequirement(makeWallet({ chainId: '0x534e5f4d41494e' }).wallet)).toBe('WRONG_NETWORK');
  });

  it('returns READY when the wallet reports registered', async () => {
    expect(await getPrivateReceivingRequirement(makeWallet({ registration: 'registered' }).wallet)).toBe('READY');
  });

  it('returns NEEDS_REGISTRATION when the wallet reports NOT_REGISTERED', async () => {
    expect(await getPrivateReceivingRequirement(makeWallet({ registration: 'not_registered' }).wallet)).toBe('NEEDS_REGISTRATION');
  });

  it('returns UNKNOWN on a non-118 probe failure instead of guessing from text', async () => {
    // "Missing channel context" text alone must NOT produce NEEDS_REGISTRATION —
    // readiness is derived from the NOT_REGISTERED protocol code, not error strings.
    const { wallet } = makeWallet({ registration: 'error' });
    expect(await getPrivateReceivingRequirement(wallet)).toBe('UNKNOWN');
  });
});

describe('enablePrivateReceiving', () => {
  it('returns UNSUPPORTED and sends no transaction for a non-privacy wallet', async () => {
    const { wallet, invokeCalls } = makeWallet({ supportsStrk20: false });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('UNSUPPORTED');
    expect(invokeCalls.length).toBe(0);
  });

  it('returns WRONG_NETWORK and sends no transaction on the wrong chain', async () => {
    const { wallet, invokeCalls } = makeWallet({ chainId: '0x534e5f4d41494e' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('WRONG_NETWORK');
    expect(invokeCalls.length).toBe(0);
  });

  it('returns READY and sends NO transaction for an already-registered wallet', async () => {
    const { wallet, invokeCalls } = makeWallet({ registration: 'registered' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('READY');
    expect(invokeCalls.length).toBe(0);
  });

  it('rejects a zero amount before calling the wallet', async () => {
    const { wallet, invokeCalls } = makeWallet({ registration: 'not_registered' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: 0n }, undefined);
    expect(res.status).toBe('FAILED');
    expect(invokeCalls.length).toBe(0);
  });

  it('invokes the real deposit registration path for an unregistered wallet', async () => {
    const { wallet, invokeCalls } = makeWallet({ registration: 'not_registered' });
    const res = await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcileConfirmed },
      undefined,
    );
    expect(res.status).toBe('CONFIRMED');
    expect(res.transactionHash).toBe('0x0abcdef123456789');
    // The dapp submits a deposit; the WALLET transparently adds registration
    // (SetViewingKey) + channel setup via its autoRegister/autoSetup prover.
    expect(invokeCalls.length).toBe(1);
    expect(invokeCalls[0][0]).toMatchObject({
      type: 'deposit',
      token: TOKEN,
      amount: '0x' + AMOUNT.toString(16),
    });
  });

  it('reports USER_REJECTED (no transaction sent) when the user declines in Ready', async () => {
    const { wallet, invokeCalls } = makeWallet({ registration: 'not_registered', invokeMode: 'reject' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('USER_REJECTED');
    expect(invokeCalls.length).toBe(1);
    expect(res.transactionHash).toBeUndefined();
  });

  it('reports ACCOUNT_FINALIZING when the prover rejects on finality', async () => {
    const { wallet } = makeWallet({ registration: 'not_registered', invokeMode: 'finalizing' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('ACCOUNT_FINALIZING');
  });

  it('reports ACCOUNT_FINALIZING when the wallet returns NOT_REGISTERED on the invoke', async () => {
    const { wallet } = makeWallet({ registration: 'not_registered', invokeMode: 'not_registered_invoke' });
    const res = await enablePrivateReceiving(wallet, { token: TOKEN, amountBase: AMOUNT }, undefined);
    expect(res.status).toBe('ACCOUNT_FINALIZING');
    expect(res.transactionHash).toBeUndefined();
  });

  it('returns SUBMITTED (never CONFIRMED) while the tx is still pending', async () => {
    const { wallet } = makeWallet({ registration: 'not_registered' });
    const res = await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcilePending },
      undefined,
    );
    expect(res.status).toBe('SUBMITTED');
    expect(res.transactionHash).toBe('0x0abcdef123456789');
  });

  it('reports FAILED when the registration tx reverts', async () => {
    const { wallet } = makeWallet({ registration: 'not_registered' });
    const res = await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcileReverted },
      undefined,
    );
    expect(res.status).toBe('FAILED');
    expect(res.transactionHash).toBe('0x0abcdef123456789');
  });

  it('reports FAILED when the tx confirms but the re-probe is not READY', async () => {
    const { wallet } = makeWallet({
      registration: 'not_registered',
      postInvokeRegistration: 'not_registered',
    });
    // After confirmation, the wallet still reports NOT_REGISTERED → not verified ready.
    const res = await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcileConfirmed },
      undefined,
    );
    expect(res.status).toBe('FAILED');
    expect(res.message).toContain('could not yet be verified');
  });

  it('emits the real step sequence via onStep', async () => {
    const { wallet } = makeWallet({ registration: 'not_registered' });
    const steps: string[] = [];
    await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcileConfirmed },
      (step) => steps.push(step),
    );
    expect(steps).toContain('CHECKING');
    expect(steps).toContain('WALLET_APPROVAL');
    expect(steps).toContain('SUBMITTED');
    expect(steps).toContain('CONFIRMING');
    expect(steps[steps.length - 1]).toBe('CONFIRMED');
  });
});

describe('no fake local state', () => {
  it('never writes a local registration flag or registry', async () => {
    const storage = {
      setItem: vi.fn(),
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      key: vi.fn(() => null),
      get length() {
        return 0;
      },
      clear: vi.fn(),
    };
    (globalThis as any).localStorage = storage;

    const { wallet } = makeWallet({ registration: 'not_registered' });
    await enablePrivateReceiving(
      wallet,
      { token: TOKEN, amountBase: AMOUNT, reconcile: reconcileConfirmed },
      undefined,
    );
    // The service performs no storage writes; readiness comes only from the wallet.
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});