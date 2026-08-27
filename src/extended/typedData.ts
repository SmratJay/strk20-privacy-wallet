/**
 * @file src/extended/typedData.ts
 * @description Pure SNIP-12 typed-data builders for native Starknet onboarding.
 *
 * These are plain object constructors that mirror the CURRENT Extended web app exactly
 * (traced from the frontend bundles): the StarkNet domain, "AccountCreation",
 * "AccountRegistration" and "Login" messages, and Starknet signature serialization.
 *
 * The module has NO runtime dependency on `starknet` (only a type import), so it is safe
 * to bundle into the browser without pulling the crypto library.
 */

import type { TypedData } from 'starknet';

/** The StarkNet (SNIP-12) domain separator used for all onboarding messages. */
export interface StarknetDomainMessage {
  name: string;
  version: string;
  chainId: string;
  revision: string | number;
}

export const STARKNET_DOMAIN_FIELDS = [
  { name: 'name', type: 'shortstring' },
  { name: 'version', type: 'shortstring' },
  { name: 'chainId', type: 'shortstring' },
  { name: 'revision', type: 'shortstring' },
] as const;

/** Normalize the domain the way the web app does (`revision` as a shortstring). */
export function buildStarknetDomain(domain: StarknetDomainMessage) {
  return { name: domain.name, version: domain.version, chainId: domain.chainId, revision: String(domain.revision) };
}

export interface WalletSignature {
  r: bigint | string;
  s: bigint | string;
}

/** SNIP-12 "AccountCreation" typed data — the message that derives the L2 key pair. */
export function accountCreationTypedData(
  wallet: string,
  domain: StarknetDomainMessage,
  accountIndex = 0,
): TypedData {
  return {
    types: {
      StarknetDomain: STARKNET_DOMAIN_FIELDS as unknown as { name: string; type: string }[],
      AccountCreation: [
        { name: 'accountIndex', type: 'felt' },
        { name: 'wallet', type: 'string' },
        { name: 'tosAccepted', type: 'bool' },
      ],
    },
    primaryType: 'AccountCreation',
    domain: buildStarknetDomain(domain),
    message: { accountIndex, wallet, tosAccepted: true },
  } as unknown as TypedData;
}

/** SNIP-12 "AccountRegistration" typed data — the message that becomes `l1Signature`. */
export function accountRegistrationTypedData(
  wallet: string,
  host: string,
  time: string,
  domain: StarknetDomainMessage,
  accountIndex = 0,
): TypedData {
  return {
    types: {
      StarknetDomain: STARKNET_DOMAIN_FIELDS as unknown as { name: string; type: string }[],
      AccountRegistration: [
        { name: 'accountIndex', type: 'felt' },
        { name: 'wallet', type: 'string' },
        { name: 'tosAccepted', type: 'bool' },
        { name: 'time', type: 'string' },
        { name: 'action', type: 'string' },
        { name: 'host', type: 'string' },
      ],
    },
    primaryType: 'AccountRegistration',
    domain: buildStarknetDomain(domain),
    message: { accountIndex, wallet, tosAccepted: true, time, action: 'REGISTER', host },
  } as unknown as TypedData;
}

/** SNIP-12 "Login" typed data — used for re-authenticating a known wallet. */
export function loginTypedData(host: string, time: string, domain: StarknetDomainMessage): TypedData {
  return {
    types: {
      StarknetDomain: STARKNET_DOMAIN_FIELDS as unknown as { name: string; type: string }[],
      Login: [
        { name: 'host', type: 'string' },
        { name: 'action', type: 'string' },
        { name: 'time', type: 'string' },
      ],
    },
    primaryType: 'Login',
    domain: buildStarknetDomain(domain),
    message: { host, action: 'LOGIN', time },
  } as unknown as TypedData;
}

/** Serialize a Starknet `[r, s]` signature the way the web app does: JSON of decimal strings. */
export function serializeStarknetSignature(sig: WalletSignature | [bigint | string, bigint | string]): string {
  const arr = Array.isArray(sig) ? sig : [sig.r, sig.s];
  return JSON.stringify(arr.map((x) => BigInt(x).toString()));
}