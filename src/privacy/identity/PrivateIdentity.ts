/**
 * Privacy Core — PrivateIdentity.
 *
 * A wallet-level private execution identity, promoted from the STRK20 shadow-account concept.
 * Conceptually:
 *
 *   MASTER WALLET KEY        controls the Starknet account (Wallet Core)
 *   STRK20 VIEWING KEY       discovers private notes (privacy layer, never stored here)
 *   PRIVATE EXECUTION ID     isolates one privacy execution context (this module)
 *
 * The identity is the deterministic STRK20 shadow-account commitment for
 * (owner, viewingKey, anonymizer, dappName) — computed with the REAL vendored SDK
 * (`ShadowAccountsBuilder.partialCommitment` / `.commitment`). Only PUBLIC commitment values are
 * ever persisted; the viewing key is accepted transiently and NEVER stored or leaked.
 *
 * NAMING — `id` vs STRK20 shadow commitment:
 *   - `id` is the public, application-level identity identifier: poseidon(owner, purpose). It
 *     names a purpose namespace for THIS app's records. It is NOT a cryptographic anonymity
 *     primitive and carries no anonymity guarantee on its own.
 *   - `partialCommitment` / `commitmentNonce0` are the actual STRK20 privacy primitives (the
 *     shadow-account commitments) derived by the vendored SDK from owner + viewing key +
 *     anonymizer + dapp name.
 *   - `purpose` is metadata/namespacing for this app; it is not automatically a cryptographic
 *     shadow-account domain unless the SDK inputs (dappName) make it so.
 *   This stage does NOT claim identities are anonymous or unlinkable.
 *
 * This is NOT cross-chain execution. It is the isolation primitive later stages build on.
 */
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { hash } from 'starknet';

export const PRIVATE_IDENTITY_STORE_PREFIX = 'orrange_private_identity_v1';

export type PrivateIdentityStatus = 'active' | 'retired';

export interface PrivateIdentity {
  /** Stable public id: poseidon(owner, purpose). No key material. */
  id: string;
  /** STRK20 private identity (the wallet's Starknet account address). */
  owner: string;
  /** Human purpose of this identity context (e.g. "treasury", "launchpad", "personal"). */
  purpose: string;
  /** Network id this identity is bound to. */
  chain: string;
  /** Nonce-independent SDK shadow commitment for this owner + dapp (public). */
  partialCommitment: string;
  /** Concrete shadow-account commitment at nonce 0 (public). */
  commitmentNonce0: string;
  status: PrivateIdentityStatus;
  createdAt: number;
}

export interface CreatePrivateIdentityInput {
  owner: string;
  purpose: string;
  chain: string;
  /** STRK20 viewing key (felt). Accepted transiently; never persisted or logged. */
  viewingKey: bigint;
  anonymizerAddress: string;
  poolContractAddress: string;
  dappName?: string;
  status?: PrivateIdentityStatus;
}

export interface PrivateIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Explicit ephemeral in-memory storage. Usable for tests or short-lived sessions, but it is NOT
 * the default application path — callers must always pass storage explicitly.
 */
export function createMemoryPrivateIdentityStorage(backing?: Map<string, string>): PrivateIdentityStorage {
  const store = backing ?? new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

/**
 * Browser-persistent identity storage (localStorage-backed). This is the normal application path:
 * identities created with this storage survive page reloads / re-opens.
 */
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

/** Stable, public identity id — never derived from the viewing key. */
export function privateIdentityId(owner: string, purpose: string): string {
  return hash.computePoseidonHash(BigInt(owner), hash.starknetKeccak(purpose));
}

export function normalizePurpose(purpose: string): string {
  const trimmed = (purpose ?? '').trim().toLowerCase();
  if (!trimmed) throw new Error('Private identity purpose is required.');
  if (trimmed.length > 64) throw new Error('Private identity purpose is too long.');
  return trimmed;
}

/**
 * Validate a stored identity record. Returns an error string, or null when the record is a
 * valid, tamper-consistent public identity record. Guards against malformed records and against
 * any accidental serialization of secret material (e.g. a stray `viewingKey` field).
 */
export function validatePrivateIdentity(record: unknown): string | null {
  const r = record as PrivateIdentity | null;
  if (r === null || typeof r !== 'object') return 'record is not an object';
  for (const key of ['id', 'owner', 'purpose', 'chain', 'partialCommitment', 'commitmentNonce0', 'status', 'createdAt'] as const) {
    if (r[key] === undefined || r[key] === null) return `missing field: ${key}`;
  }
  // Defense in depth: never accept a record that carries secret material.
  for (const secretKey of ['viewingKey', 'secret', 'privateKey', 'masterKey']) {
    if ((r as unknown as Record<string, unknown>)[secretKey] !== undefined) return `record must not carry ${secretKey}`;
  }
  if (typeof r.id !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.id)) return 'malformed id';
  if (typeof r.owner !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.owner)) return 'malformed owner';
  if (typeof r.purpose !== 'string' || r.purpose.length === 0 || r.purpose.length > 64) return 'malformed purpose';
  if (typeof r.chain !== 'string' || r.chain.length === 0 || r.chain.length > 32) return 'malformed chain';
  if (r.status !== 'active' && r.status !== 'retired') return 'malformed status';
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt) || r.createdAt <= 0) return 'malformed createdAt';
  // The public id must be consistent with owner + purpose (detects mislabeled/tampered records).
  if (privateIdentityId(r.owner, r.purpose).toLowerCase() !== r.id.toLowerCase()) {
    return 'id does not match owner + purpose';
  }
  return null;
}

/**
 * Derive the SDK shadow-account commitments for (owner, viewingKey, anonymizer, dapp).
 * Pure computation — no network. The viewing key is consumed transiently.
 */
export async function derivePrivateIdentityCommitments(
  input: Pick<CreatePrivateIdentityInput, 'owner' | 'viewingKey' | 'anonymizerAddress' | 'poolContractAddress' | 'dappName'>,
): Promise<{ partialCommitment: string; commitmentNonce0: string }> {
  const dappName = input.dappName ?? 'orrange';
  const transfers = createPrivateTransfers({
    account: { address: toFelt(input.owner), signer: {} as never },
    viewingKeyProvider: { getViewingKey: async () => input.viewingKey },
    provingProvider: { url: 'https://prover.invalid', chainId: '0x0' } as never,
    discoveryProvider: { url: 'https://discovery.invalid' } as never,
    poolContractAddress: toFelt(input.poolContractAddress),
    shadowAccountAnonymizerAddress: toFelt(input.anonymizerAddress),
  });
  const shadow = transfers.build().shadowAccounts(dappName);
  const partial = await shadow.partialCommitment();
  const nonce0 = await shadow.commitment(0n);
  return { partialCommitment: partial.toString(), commitmentNonce0: nonce0.toString() };
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
    // Drop malformed/tampered records (e.g. a stray viewingKey field) rather than surface them.
    return parsed.filter((record) => validatePrivateIdentity(record) === null);
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
 * Create a private identity. `storage` is REQUIRED and explicit: wallet identity state is never
 * silently defaulted to ephemeral memory. Use `createBrowserPrivateIdentityStorage()` for the
 * normal persistent application path, or an explicit memory store for tests.
 */
export async function createPrivateIdentity(
  input: CreatePrivateIdentityInput,
  storage: PrivateIdentityStorage,
): Promise<PrivateIdentity> {
  const purpose = normalizePurpose(input.purpose);
  const id = privateIdentityId(input.owner, purpose);
  // Deduplicate by (owner, purpose): retire-then-recreate is explicit.
  const existing = readPrivateIdentities(storage, input.chain, input.owner).filter((i) => i.id !== id);

  const commitments = await derivePrivateIdentityCommitments(input);
  const identity: PrivateIdentity = {
    id,
    owner: toFelt(input.owner),
    purpose,
    chain: input.chain,
    partialCommitment: commitments.partialCommitment,
    commitmentNonce0: commitments.commitmentNonce0,
    status: input.status ?? 'active',
    createdAt: Date.now(),
  };
  writePrivateIdentities(storage, input.chain, input.owner, [...existing, identity]);
  return identity;
}

export function retirePrivateIdentity(
  storage: PrivateIdentityStorage,
  chain: string,
  owner: string,
  id: string,
): PrivateIdentity {
  const identities = readPrivateIdentities(storage, chain, owner);
  const target = identities.find((i) => i.id === id);
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