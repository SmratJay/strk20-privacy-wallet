/**
 * Privacy Core — PrivateIdentity (REAL STRK20 shadow-account model).
 *
 * A wallet-level shadow identity. Each identity is the deterministic STRK20 shadow-account
 * commitment for (owner, viewingKey, anonymizer, appName, nonce), computed with the REAL vendored
 * SDK (`ShadowAccountsBuilder.partialCommitment` / `.commitment(nonce)`), plus the counterfactual
 * shadow-account ADDRESS derived by the pinned anonymizer formula.
 *
 * Key hierarchy (never conflated):
 *   MASTER WALLET KEY    → controls the Starknet account (Wallet Core, custody)
 *   STRK20 VIEWING KEY   → discovers private notes (privacy layer, in-memory only)
 *   SHADOW IDENTITY      → deterministic (appName, nonce) execution identity (this module)
 *
 * NONCE / LINKAGE SEMANTICS (documented, explicit):
 *   same wallet + network + appName + nonce → SAME commitment + shadow address (linkable)
 *   new nonce → NEW commitment + shadow address (fresh, unlinkable identity)
 *   The caller MUST NOT silently reuse appName+nonce when a fresh identity is required.
 *
 * Only PUBLIC values are ever persisted: commitment, shadow address, anonymizer, appName, nonce.
 * The viewing key is accepted transiently and NEVER stored or leaked.
 *
 * SECURITY:
 *   - records are wallet + network scoped (chain + owner are part of the storage namespace and
 *     re-validated on every read — a Sepolia identity can never be reused on mainnet);
 *   - no viewing key, secret, master key, or signer material is ever serialized;
 *   - the commitment/shadow-address cross-check rejects tampered or mislabeled records.
 */
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { shortString } from 'starknet';
import {
  shadowAddressFromCommitment,
  normalizeAddress,
} from '../strk20/shadowAccount';

export const PRIVATE_IDENTITY_STORE_PREFIX = 'orrange_private_identity_v1';

export type PrivateIdentityStatus = 'active' | 'retired';

export interface PrivateIdentity {
  /** Canonical shadow identity id: the STRK20 shadow-account commitment. */
  id: string;
  /** The root wallet's Starknet account address (the identity's owner). */
  owner: string;
  /** Network id this identity is bound to. */
  chain: string;
  /** Application scope shared by this identity (Cairo short string). */
  appName: string;
  /** Identity nonce — selects the deterministic shadow address. */
  nonce: string;
  /** RC5 shadow-account anonymizer address (network-scoped public config). */
  anonymizerAddress: string;
  /** Nonce-independent SDK shadow commitment for this owner + dapp. */
  partialCommitment: string;
  /** Full SDK shadow commitment at `nonce` (this identity's id). */
  commitment: string;
  /** Counterfactual shadow-account address for `commitment` (the identity's on-chain identity). */
  shadowAddress: string;
  status: PrivateIdentityStatus;
  createdAt: number;
}

export interface CreatePrivateIdentityInput {
  owner: string;
  /** Network id. */
  chain: string;
  /** Application scope (Cairo short string). */
  appName: string;
  /** Identity nonce — a fresh nonce yields a fresh, unlinkable shadow identity. */
  nonce: bigint;
  /** STRK20 viewing key (felt). Accepted transiently; never persisted or logged. */
  viewingKey: bigint;
  anonymizerAddress: string;
  poolContractAddress: string;
  status?: PrivateIdentityStatus;
}

export interface PrivateIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Explicit ephemeral in-memory storage (tests / short-lived sessions). */
export function createMemoryPrivateIdentityStorage(backing?: Map<string, string>): PrivateIdentityStorage {
  const store = backing ?? new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

/** Browser-persistent identity storage (localStorage-backed). The normal application path. */
export function createBrowserPrivateIdentityStorage(): PrivateIdentityStorage {
  const local = typeof localStorage !== 'undefined' ? localStorage : null;
  return {
    getItem: (k) => (local ? local.getItem(k) : null),
    setItem: (k, v) => {
      if (local) local.setItem(k, v);
    },
    removeItem: (k) => {
      if (local) local.removeItem(k);
    },
  };
}

function toFelt(value: bigint | string): string {
  return typeof value === 'string' && /^0x/i.test(value) ? value : '0x' + BigInt(value).toString(16);
}

function canonicalFelt(value: bigint | string): string {
  return '0x' + BigInt(value).toString(16);
}

/** Validate an appName: a non-empty Cairo short string (≤ 31 ASCII chars). */
export function normalizeAppName(appName: string): string {
  const trimmed = (appName ?? '').trim();
  if (!trimmed) throw new Error('Shadow identity appName is required.');
  try {
    shortString.encodeShortString(trimmed);
  } catch {
    throw new Error('Shadow identity appName must fit in a Cairo short string (31 ASCII characters).');
  }
  return trimmed;
}

/** Validate a shadow identity nonce: a non-negative bigint. */
export function validateShadowNonce(nonce: bigint): bigint {
  if (typeof nonce !== 'bigint' || nonce < 0n) {
    throw new Error('Shadow identity nonce must be a non-negative bigint.');
  }
  return nonce;
}

/**
 * Validate a stored identity record. Returns an error string, or null when the record is a valid,
 * tamper-consistent PUBLIC identity record. Rejects malformed records and any accidental
 * serialization of secret material (e.g. a stray `viewingKey`/`secret` field), and cross-checks
 * that `shadowAddress` is consistent with `commitment` + `anonymizerAddress`.
 */
export function validatePrivateIdentity(record: unknown): string | null {
  const r = record as PrivateIdentity | null;
  if (r === null || typeof r !== 'object') return 'record is not an object';
  for (const key of [
    'id', 'owner', 'chain', 'appName', 'nonce', 'anonymizerAddress',
    'partialCommitment', 'commitment', 'shadowAddress', 'status', 'createdAt',
  ] as const) {
    if (r[key] === undefined || r[key] === null) return `missing field: ${key}`;
  }
  // Defense in depth: never accept a record that carries secret material.
  for (const secretKey of ['viewingKey', 'secret', 'privateKey', 'masterKey', 'signer']) {
    if ((r as unknown as Record<string, unknown>)[secretKey] !== undefined) {
      return `record must not carry ${secretKey}`;
    }
  }
  if (typeof r.id !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.id)) return 'malformed id';
  if (typeof r.owner !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.owner)) return 'malformed owner';
  if (typeof r.chain !== 'string' || r.chain.length === 0 || r.chain.length > 32) return 'malformed chain';
  if (typeof r.anonymizerAddress !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.anonymizerAddress)) {
    return 'malformed anonymizerAddress';
  }
  if (typeof r.commitment !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.commitment)) return 'malformed commitment';
  if (typeof r.partialCommitment !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.partialCommitment)) {
    return 'malformed partialCommitment';
  }
  if (typeof r.shadowAddress !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.shadowAddress)) {
    return 'malformed shadowAddress';
  }
  if (typeof r.nonce !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.nonce)) return 'malformed nonce';
  if (typeof r.appName !== 'string' || r.appName.length === 0 || r.appName.length > 64) {
    return 'malformed appName';
  }
  if (r.status !== 'active' && r.status !== 'retired') return 'malformed status';
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt) || r.createdAt <= 0) {
    return 'malformed createdAt';
  }
  // The id must BE the commitment, and the shadow address must be consistent with it.
  if (canonicalFelt(r.id) !== canonicalFelt(r.commitment)) return 'id does not match commitment';
  if (
    shadowAddressFromCommitment(BigInt(r.commitment), BigInt(r.anonymizerAddress)).toLowerCase() !==
    r.shadowAddress.toLowerCase()
  ) {
    return 'shadowAddress does not match commitment + anonymizer';
  }
  return null;
}

/**
 * Derive the SDK shadow-account commitment + shadow address for
 * (owner, viewingKey, anonymizer, dapp, nonce). Pure computation — no network. The viewing key is
 * consumed transiently.
 */
export async function deriveShadowIdentity(
  input: Pick<
    CreatePrivateIdentityInput,
    'owner' | 'viewingKey' | 'anonymizerAddress' | 'poolContractAddress' | 'appName' | 'nonce'
  >,
): Promise<{ partialCommitment: string; commitment: string; shadowAddress: string }> {
  const appName = normalizeAppName(input.appName ?? 'orrange');
  const nonce = validateShadowNonce(input.nonce);
  const transfers = createPrivateTransfers({
    account: { address: toFelt(input.owner), signer: {} as never },
    viewingKeyProvider: { getViewingKey: async () => input.viewingKey },
    provingProvider: { url: 'https://prover.invalid', chainId: '0x0' } as never,
    discoveryProvider: { url: 'https://discovery.invalid' } as never,
    poolContractAddress: toFelt(input.poolContractAddress),
    shadowAccountAnonymizerAddress: toFelt(input.anonymizerAddress),
  });
  const shadow = transfers.build().shadowAccounts(appName);
  const partial = await shadow.partialCommitment();
  const commitment = await shadow.commitment(nonce);
  const shadowAddress = shadowAddressFromCommitment(commitment, BigInt(input.anonymizerAddress));
  return {
    partialCommitment: partial.toString(),
    commitment: commitment.toString(),
    shadowAddress,
  };
}

function storageKey(chain: string, owner: string): string {
  return `${PRIVATE_IDENTITY_STORE_PREFIX}_${chain}_${owner.toLowerCase()}`;
}

export function readPrivateIdentities(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
): PrivateIdentity[] {
  const raw = storage.getItem(storageKey(chain, owner));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PrivateIdentity[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record) => {
      if (validatePrivateIdentity(record) !== null) return false;
      // The record must belong to THIS query namespace: never surface a record that claims a
      // different owner or a different chain, even if it sat in this storage key (tampering).
      if (canonicalFelt(record.owner) !== canonicalFelt(owner)) return false;
      if (record.chain !== chain) return false;
      return true;
    });
  } catch {
    return [];
  }
}

function writePrivateIdentities(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
  identities: PrivateIdentity[],
): void {
  storage.setItem(storageKey(chain, owner), JSON.stringify(identities));
}

/**
 * Create a shadow identity. `storage` is REQUIRED and explicit. DEDUPE: at most one record per
 * (owner, chain, appName, nonce) — re-creating the same tuple REPLACES it (including a retired
 * one). A new nonce yields a NEW identity (fresh shadow address).
 */
export async function createPrivateIdentity(
  input: CreatePrivateIdentityInput,
  storage: PrivateIdentityStorage,
): Promise<PrivateIdentity> {
  const appName = normalizeAppName(input.appName);
  const nonce = validateShadowNonce(input.nonce);
  const existing = readPrivateIdentities(storage, input.chain, input.owner).filter(
    (i) => !(i.appName === appName && BigInt(i.nonce) === nonce),
  );

  const derived = await deriveShadowIdentity({ ...input, appName, nonce });
  const identity: PrivateIdentity = {
    id: toFelt(derived.commitment),
    owner: toFelt(input.owner),
    chain: input.chain,
    appName,
    nonce: toFelt(nonce),
    anonymizerAddress: toFelt(input.anonymizerAddress),
    partialCommitment: toFelt(derived.partialCommitment),
    commitment: toFelt(derived.commitment),
    shadowAddress: toFelt(derived.shadowAddress),
    status: input.status ?? 'active',
    createdAt: Date.now(),
  };
  writePrivateIdentities(storage, input.chain, input.owner, [...existing, identity]);
  return identity;
}

/** Retire an identity (by its commitment id). Retiring does not change the on-chain shadow. */
export function retirePrivateIdentity(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
  id: string,
): PrivateIdentity {
  const identities = readPrivateIdentities(storage, chain, owner);
  const target = identities.find((i) => canonicalFelt(i.id) === canonicalFelt(id));
  if (!target) throw new Error(`No private identity ${id} for ${owner} on ${chain}.`);
  const retired: PrivateIdentity = { ...target, status: 'retired' };
  writePrivateIdentities(storage, chain, owner, identities.map((i) => (i.id === id ? retired : i)));
  return retired;
}

export function listPrivateIdentities(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
): PrivateIdentity[] {
  return readPrivateIdentities(storage, chain, owner);
}

/** Resolve an identity by (appName, nonce), scoped to this wallet + network. Null when absent. */
export function findPrivateIdentity(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
  appName: string,
  nonce: bigint,
): PrivateIdentity | null {
  return (
    listPrivateIdentities(storage, chain, owner).find(
      (i) => i.appName === appName && BigInt(i.nonce) === nonce,
    ) ?? null
  );
}

/** Convenience re-export for cross-module imports. */
export { normalizeAddress };