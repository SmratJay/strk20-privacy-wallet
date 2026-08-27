/**
 * @file src/extended/onboarding.ts
 * @description Extended account onboarding (account creation) helpers.
 *
 * Ports the official SDK's `onboarding.py`. Extended derives the L2 Stark key pair from
 * an L1 signature (grindKey over the ECDSA `r`), then POSTs an onboarding payload to
 * `{onboardingUrl}/auth/onboard`.
 *
 * The L1 signing (EIP-712 "AccountCreation" / "AccountRegistration") is the caller's
 * responsibility: it must be produced by the connected wallet's signer. The key
 * derivation and payload shapes below match the official SDK exactly.
 */

import { pedersen, privateKeyFromEthSignature, starkKeyOf, starkSign } from './crypto';
import { getExtendedEnvironment } from './config';
import type { AccountInfo, ApiResponse } from './types';
import type { WalletSignature } from './typedData';
// Pure SNIP-12 typed-data builders (no runtime starknet dependency — see typedData.ts).
export {
  buildStarknetDomain,
  accountCreationTypedData,
  accountRegistrationTypedData,
  loginTypedData,
  serializeStarknetSignature,
  type StarknetDomainMessage,
  type WalletSignature,
} from './typedData';

export interface StarkKeyPair {
  privateKey: string; // 0x hex
  publicKey: string; // 0x hex
}

/** Derive the L2 Stark key pair from an L1 ECDSA signature (0x + 65 bytes). */
export function deriveKeyPairFromSignature(l1Signature: string): StarkKeyPair {
  const privateKey = '0x' + privateKeyFromEthSignature(l1Signature);
  const publicKey = starkKeyOf(privateKey);
  return { privateKey, publicKey };
}

export interface OnboardingPayload {
  l1Signature: string;
  l2Key: string;
  l2Signature: { r: string; s: string };
  accountCreation: {
    accountIndex: number;
    wallet: string;
    tosAccepted: boolean;
    time: string;
    action: string;
    host: string;
  };
  referralCode?: string;
}

export interface OnboardParams {
  /** The connected wallet address (0x hex). */
  wallet: string;
  /** The registration signature produced by the L1 signer (EIP-712 "AccountRegistration"). */
  l1Signature: string;
  /** The key-derivation signature produced by the L1 signer (EIP-712 "AccountCreation"). */
  keyDerivationSignature: string;
  accountIndex?: number;
  action?: 'REGISTER' | 'CREATE_SUB_ACCOUNT';
  referralCode?: string;
  time?: string;
}

/**
 * Build the onboarding payload that `POST /auth/onboard` expects.
 *
 * `l2Signature` signs `pedersen(l1Address, l2PublicKey)` with the derived L2 key, exactly
 * as the official SDK does.
 */
export function buildOnboardingPayload(params: OnboardParams): OnboardingPayload {
  const accountIndex = params.accountIndex ?? 0;
  const action = params.action ?? 'REGISTER';
  const keyPair = deriveKeyPairFromSignature(params.keyDerivationSignature);
  const host = getExtendedEnvironment().onboardingUrl;

  const walletBig = BigInt(params.wallet);
  const l2Message = pedersen(walletBig, BigInt(keyPair.publicKey));
  const l2Signature = starkSign(l2Message, keyPair.privateKey);

  return {
    l1Signature: params.l1Signature,
    l2Key: keyPair.publicKey,
    l2Signature,
    accountCreation: {
      accountIndex,
      wallet: params.wallet,
      tosAccepted: true,
      time: params.time ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      action,
      host,
    },
    referralCode: params.referralCode,
  };
}

export interface OnboardedAccount {
  account: AccountInfo;
  keyPair: StarkKeyPair;
}

/** Submit an onboarding payload to Extended and return the default account + key pair. */
export async function onboard(params: OnboardParams): Promise<OnboardedAccount> {
  const payload = buildOnboardingPayload(params);
  const keyPair = deriveKeyPairFromSignature(params.keyDerivationSignature);

  const res = await fetch(`${getExtendedEnvironment().onboardingUrl}/auth/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'orrange/0.1' },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as ApiResponse<{ defaultAccount: AccountInfo }>;
  if (!res.ok || !json.data?.defaultAccount) {
    const message = json.error?.message ?? `Onboarding failed (HTTP ${res.status})`;
    throw new Error(message);
  }

  return { account: json.data.defaultAccount, keyPair };
}

// ─────────────────────────────────────────────────────────────────────────────────
// Native Starknet-wallet onboarding (current Extended web app flow, traced from the
// frontend bundles + verified against the live API).
//
// A Starknet wallet (Braavos / Argent / Ready / Privy) signs SNIP-12 typed data:
//   - "AccountCreation"  → L2 Stark key pair is derived from the signature (grindKey over r)
//   - "AccountRegistration" → becomes `l1Signature` (serialized `[r, s]` JSON)
// then the app POSTs `/auth/register` with `walletType: "STARKNET"`.
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Derive the L2 Stark key pair from a Starknet wallet signature (grindKey over `r`).
 * Matches `generate_private_key_from_eth_signature(r || s)` used by the web app.
 */
export function deriveStarknetKeyPair(sig: WalletSignature): StarkKeyPair {
  const rHex = BigInt(sig.r).toString(16).padStart(64, '0');
  const sHex = BigInt(sig.s).toString(16).padStart(64, '0');
  // ethSigToPrivate only uses the first 32 bytes (`r`); pad a full 65-byte EVM sig with v=00.
  const fullSig = '0x' + rHex + sHex + '00';
  return deriveKeyPairFromSignature(fullSig);
}

/** Build the `POST /auth/register` body for a native Starknet wallet. */
export function buildStarknetRegisterPayload(params: {
  wallet: string;
  l1Signature: string; // serialized AccountRegistration signature
  keyPair: StarkKeyPair;
  host: string;
  time: string;
  referralCode?: string | null;
  accountIndex?: number;
}): Record<string, unknown> {
  const accountIndex = params.accountIndex ?? 0;
  const l2Message = pedersen(BigInt(params.wallet), BigInt(params.keyPair.publicKey));
  const l2Signature = starkSign(l2Message, params.keyPair.privateKey);
  return {
    l1Signature: params.l1Signature,
    l2Key: params.keyPair.publicKey,
    l2Signature,
    referralCode: params.referralCode ?? null,
    accountCreation: {
      host: params.host,
      accountIndex,
      wallet: params.wallet,
      tosAccepted: true,
      action: 'REGISTER',
      time: params.time,
    },
    walletType: 'STARKNET',
  };
}

/** Build the `POST /auth/login` body for a native Starknet wallet. */
export function buildStarknetLoginPayload(params: {
  walletAddress: string;
  l1Signature: string; // serialized Login signature
  host: string;
  time: string;
}): Record<string, unknown> {
  return {
    l1Signature: params.l1Signature,
    login: { host: params.host, action: 'LOGIN', time: params.time },
    walletType: 'STARKNET',
    walletAddress: params.walletAddress,
  };
}

export interface RegisterResult {
  status: string;
  cookies: string[];
}

/**
 * POST `/auth/register` for a native Starknet wallet. Returns the status string and any
 * session cookies set by Extended (used for subsequent authenticated API calls).
 */
export async function registerStarknetWallet(
  payload: Record<string, unknown>,
  opts?: { rememberMe?: boolean },
): Promise<RegisterResult> {
  const env = getExtendedEnvironment();
  const query = opts?.rememberMe ? '?rememberMe=true' : '';
  const res = await fetch(`${env.onboardingUrl}/auth/register${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'orrange/0.1' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Extended register failed (HTTP ${res.status})${text ? `: ${text}` : ''}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { status: text.replace(/"/g, ''), cookies };
}

/** POST `/auth/login` for a native Starknet wallet (re-auth). Returns session cookies. */
export async function loginStarknetWallet(
  payload: Record<string, unknown>,
  opts?: { rememberMe?: boolean },
): Promise<RegisterResult> {
  const env = getExtendedEnvironment();
  const query = opts?.rememberMe ? '?rememberMe=true' : '';
  const res = await fetch(`${env.onboardingUrl}/auth/login${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'orrange/0.1' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Extended login failed (HTTP ${res.status})${text ? `: ${text}` : ''}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { status: text.replace(/"/g, ''), cookies };
}
