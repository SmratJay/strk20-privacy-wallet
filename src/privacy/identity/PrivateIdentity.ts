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

function memoryStorage(): PrivateIdentityStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
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
    return Array.isArray(parsed) ? parsed : [];
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

export async function createPrivateIdentity(
  input: CreatePrivateIdentityInput,
  storage: PrivateIdentityStorage = memoryStorage(),
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