/**
 * @file src/protocol/witnessStore.ts
 * @description Private Position Witness Persistence (encrypted at rest)
 *
 * All witnesses (ownerSecret, nonce, quantity, entry price, margin, funding, fees) are
 * stored AES-GCM encrypted. The encryption key is derived from a wallet SIGNATURE of a
 * fixed challenge (PEL_WITNESS_ENCRYPTION_V2) — never from the public wallet address.
 *
 *   key = AES-GCM(SHA-256(signature))
 *   stored payload = { version, encrypted: true, iv: b64, ciphertext: b64 }
 *
 * There is NO plaintext fallback: if a signature/WebCrypto is unavailable, the caller
 * cannot persist or read witnesses (fail closed).
 */

import { PrivatePositionState } from './types';

const STORE_VERSION = 3;
const NAMESPACE = 'pel_witness_v3';
const ENCRYPTION_MSG = 'PEL_WITNESS_ENCRYPTION_V2'; // signed by the wallet to derive the key

// ─── CSPRNG Key Generation ───────────────────────────────────────────────────

/** Generate a true 256-bit CSPRNG secret (never derived from public wallet address). */
export function generateOwnerSecret(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    bytes.set(nodeCrypto.randomBytes(32));
  }
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a true 256-bit CSPRNG nonce. */
export function generateNonce(): string {
  return generateOwnerSecret();
}

// ─── In-Memory Fallback (Node SSR / tests) ────────────────────────────────────

const memStore = new Map<string, string>();

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function readRaw(walletAddress: string): string | null {
  if (storageAvailable()) return localStorage.getItem(storeKey(walletAddress));
  return memStore.get(storeKey(walletAddress)) ?? null;
}

function writeRaw(walletAddress: string, raw: string): void {
  if (storageAvailable()) localStorage.setItem(storeKey(walletAddress), raw);
  else memStore.set(storeKey(walletAddress), raw);
}

function removeRaw(walletAddress: string): void {
  if (storageAvailable()) localStorage.removeItem(storeKey(walletAddress));
  else memStore.delete(storeKey(walletAddress));
}

function storeKey(walletAddress: string): string {
  return `${NAMESPACE}_${walletAddress.toLowerCase()}`;
}

// ─── AES-GCM (Web Crypto) ─────────────────────────────────────────────────────

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WITNESS_STORE: Web Crypto (crypto.subtle) is unavailable; cannot encrypt witnesses');
  }
  return crypto.subtle;
}

/** Derive the AES-GCM key from a wallet signature (deterministic for a fixed message). */
export async function deriveWitnessKey(signature: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await subtle().digest('SHA-256', enc.encode(signature));
  return subtle().importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function encrypt(data: string, key: CryptoKey): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(data));
  return { iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

async function decrypt(ivB64: string, ctB64: string, key: CryptoKey): Promise<string> {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return new TextDecoder().decode(plain);
}

// ─── Serialisation (BigInt-aware) ─────────────────────────────────────────────

function serialise(witnesses: PrivatePositionState[]): string {
  return JSON.stringify({ version: STORE_VERSION, witnesses }, (_, v) =>
    typeof v === 'bigint' ? `__bigint__${v.toString()}` : v
  );
}

function deserialise(raw: string): PrivatePositionState[] {
  const parsed = JSON.parse(raw, (_, v) => {
    if (typeof v === 'string' && v.startsWith('__bigint__')) return BigInt(v.slice(10));
    return v;
  });
  if (!parsed?.witnesses || !Array.isArray(parsed.witnesses)) return [];
  return parsed.witnesses as PrivatePositionState[];
}

// ─── Errors ────────────────────────────────────────────────────────────────────

export class WitnessCorruptionError extends Error {
  constructor(message: string) {
    super(`[WitnessStore Corruption] ${message}`);
    this.name = 'WitnessCorruptionError';
  }
}

export class WitnessMissingError extends Error {
  constructor(commitment: string) {
    super(`[WitnessStore Missing] No private witness found for commitment: ${commitment}`);
    this.name = 'WitnessMissingError';
  }
}

// ─── Core read/write (encrypted) ──────────────────────────────────────────────

async function loadAllWitnesses(walletAddress: string, signature: string): Promise<PrivatePositionState[]> {
  const raw = readRaw(walletAddress);
  if (!raw) return [];
  try {
    const outer = JSON.parse(raw);
    if (!outer?.encrypted) {
      // Legacy/plaintext records are not trusted — fail closed rather than read plaintext.
      throw new WitnessCorruptionError('Refusing to read plaintext witness storage');
    }
    const key = await deriveWitnessKey(signature);
    const plain = await decrypt(outer.iv, outer.ciphertext, key);
    return deserialise(plain);
  } catch (err: any) {
    // Wrong signature / tampered ciphertext / corrupt payload all surface here.
    if (err instanceof WitnessCorruptionError) throw err;
    throw new WitnessCorruptionError(`Failed to decrypt stored witnesses: ${err?.message ?? err}`);
  }
}

async function persistAllWitnesses(walletAddress: string, witnesses: PrivatePositionState[], signature: string): Promise<void> {
  const key = await deriveWitnessKey(signature);
  const { iv, ciphertext } = await encrypt(serialise(witnesses), key);
  const payload = JSON.stringify({ version: STORE_VERSION, encrypted: true, iv, ciphertext });
  writeRaw(walletAddress, payload);
}

// ─── Validation ────────────────────────────────────────────────────────────────

function validateWitness(witness: PrivatePositionState): void {
  if (!witness.commitment || typeof witness.commitment !== 'string' || !witness.commitment.startsWith('0x')) {
    throw new WitnessCorruptionError('Invalid commitment in witness');
  }
  if (!witness.ownerSecret || typeof witness.ownerSecret !== 'string' || !witness.ownerSecret.startsWith('0x')) {
    throw new WitnessCorruptionError('Invalid ownerSecret in witness');
  }
  if (witness.quantitySats <= 0n) throw new WitnessCorruptionError('Quantity sats must be positive');
  if (witness.entryPriceCents <= 0n) throw new WitnessCorruptionError('Entry price cents must be positive');
  if (witness.marginCents <= 0n) throw new WitnessCorruptionError('Margin cents must be positive');
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Save a witness (encrypted). Idempotent per commitment. */
export async function saveWitness(walletAddress: string, witness: PrivatePositionState, signature: string): Promise<void> {
  validateWitness(witness);
  const existing = await loadAllWitnesses(walletAddress, signature);
  const deduped = existing.filter((w) => w.commitment !== witness.commitment);
  await persistAllWitnesses(walletAddress, [witness, ...deduped], signature);
}

/** Load a single witness by commitment (encrypted). */
export async function loadWitness(
  walletAddress: string,
  commitment: string,
  signature: string,
): Promise<PrivatePositionState | null> {
  try {
    const all = await loadAllWitnesses(walletAddress, signature);
    return all.find((w) => w.commitment.toLowerCase() === commitment.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

/** List all witnesses for an address (encrypted). */
export async function listWitnesses(walletAddress: string, signature: string): Promise<PrivatePositionState[]> {
  return loadAllWitnesses(walletAddress, signature);
}

/** Delete a witness after it has been consumed (encrypted). */
export async function deleteWitness(walletAddress: string, commitment: string, signature: string): Promise<void> {
  const existing = await loadAllWitnesses(walletAddress, signature);
  const updated = existing.filter((w) => w.commitment.toLowerCase() !== commitment.toLowerCase());
  await persistAllWitnesses(walletAddress, updated, signature);
}

/** Update a witness in-place (UPDATE/FUND). Enforces ownerSecret immutability. */
export async function updateWitness(
  walletAddress: string,
  oldCommitment: string,
  newWitness: PrivatePositionState,
  signature: string,
): Promise<void> {
  validateWitness(newWitness);
  const existing = await loadAllWitnesses(walletAddress, signature);
  const oldWitness = existing.find((w) => w.commitment.toLowerCase() === oldCommitment.toLowerCase());
  if (oldWitness && oldWitness.ownerSecret.toLowerCase() !== newWitness.ownerSecret.toLowerCase()) {
    throw new Error('OWNER_SECRET_MUTATION_FORBIDDEN: ownerSecret must remain constant across the position lifecycle');
  }
  const removed = existing.filter((w) => w.commitment.toLowerCase() !== oldCommitment.toLowerCase());
  await persistAllWitnesses(walletAddress, [newWitness, ...removed], signature);
}

// ─── Export / Import (user-facing recovery) ───────────────────────────────────

export async function exportWitnesses(walletAddress: string, signature: string): Promise<string> {
  const witnesses = await loadAllWitnesses(walletAddress, signature);
  const key = await deriveWitnessKey(signature);
  const { iv, ciphertext } = await encrypt(serialise(witnesses), key);
  return JSON.stringify({ encrypted: true, version: STORE_VERSION, iv, ciphertext });
}

export async function importWitnesses(
  walletAddress: string,
  exportJson: string,
  signature: string,
): Promise<{ imported: number; skipped: number }> {
  const outer = JSON.parse(exportJson);
  let plain: string;
  if (outer.encrypted) {
    const key = await deriveWitnessKey(signature);
    plain = await decrypt(outer.iv, outer.ciphertext, key);
  } else {
    throw new Error('WITNESS_STORE: refusing to import a plaintext export');
  }
  const incoming = deserialise(plain);
  const existing = await loadAllWitnesses(walletAddress, signature);
  const existingCommitments = new Set(existing.map((w) => w.commitment.toLowerCase()));
  let imported = 0;
  let skipped = 0;
  for (const w of incoming) {
    validateWitness(w);
    if (existingCommitments.has(w.commitment.toLowerCase())) { skipped++; continue; }
    existing.push(w);
    imported++;
  }
  await persistAllWitnesses(walletAddress, existing, signature);
  return { imported, skipped };
}

export { ENCRYPTION_MSG };

/**
 * Request the wallet to sign the fixed encryption challenge, returning a stable
 * string used as key material for witness encryption/decryption.
 *
 * Deterministic for a fixed message + wallet (RFC6979), so re-derivation across
 * sessions yields the same key.
 */
export async function requestWitnessEncryptionSignature(provider: any, chainId: string): Promise<string> {
  if (!provider?.request) {
    throw new Error('WITNESS_STORE: no wallet provider available to derive the encryption key');
  }
  const res = await provider.request({
    type: 'wallet_signTypedData',
    params: {
      message: {
        types: {
          StarkNetDomain: [
            { name: 'name', type: 'felt' },
            { name: 'version', type: 'felt' },
            { name: 'chainId', type: 'felt' },
          ],
          Message: [{ name: 'challenge', type: 'felt' }],
        },
        primaryType: 'Message',
        domain: { name: 'PEL Privacy Wallet', version: '2', chainId },
        message: { challenge: ENCRYPTION_MSG },
      },
    },
  });
  const sig = Array.isArray(res) ? res : [res];
  if (!sig || sig.length < 1 || !sig[0]) {
    throw new Error('WITNESS_STORE: wallet signature required to derive the encryption key');
  }
  return sig.join('|');
}

// ─── Authoritative Pending Payout Persistence ───────────────────────────────

import { PendingPayoutRecord, PositionPayoutStatus } from './types';

const PAYOUT_NAMESPACE = 'pel_pending_payouts_v3';

function payoutStoreKey(walletAddress: string): string {
  return `${PAYOUT_NAMESPACE}_${walletAddress.toLowerCase()}`;
}

export function loadPendingPayouts(walletAddress: string): PendingPayoutRecord[] {
  const key = payoutStoreKey(walletAddress);
  const raw = storageAvailable() ? localStorage.getItem(key) : memStore.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw, (_, v) =>
      typeof v === 'string' && v.startsWith('__bigint__') ? BigInt(v.slice(10)) : v
    );
    return Array.isArray(parsed) ? (parsed as PendingPayoutRecord[]) : [];
  } catch {
    return [];
  }
}

export function savePendingPayout(walletAddress: string, payout: PendingPayoutRecord): void {
  const key = payoutStoreKey(walletAddress);
  const existing = loadPendingPayouts(walletAddress).filter((p) => p.commitment !== payout.commitment);
  existing.push(payout);
  const serialised = JSON.stringify(existing, (_, v) =>
    typeof v === 'bigint' ? `__bigint__${v.toString()}` : v
  );
  if (storageAvailable()) localStorage.setItem(key, serialised);
  else memStore.set(key, serialised);
}

export function updatePendingPayoutStatus(
  walletAddress: string,
  commitment: string,
  status: PositionPayoutStatus,
  details?: { failureReason?: string; shieldedNoteCommitment?: string }
): void {
  const existing = loadPendingPayouts(walletAddress);
  const target = existing.find((p) => p.commitment === commitment);
  if (!target) return;
  const updated: PendingPayoutRecord = {
    ...target,
    status,
    failureReason: details?.failureReason ?? target.failureReason,
    shieldedNoteCommitment: details?.shieldedNoteCommitment ?? target.shieldedNoteCommitment,
    updatedAtMs: Date.now(),
  };
  savePendingPayout(walletAddress, updated);
}

export function clearPendingPayout(walletAddress: string, commitment: string): void {
  const key = payoutStoreKey(walletAddress);
  const remaining = loadPendingPayouts(walletAddress).filter((p) => p.commitment !== commitment);
  const serialised = JSON.stringify(remaining, (_, v) =>
    typeof v === 'bigint' ? `__bigint__${v.toString()}` : v
  );
  if (storageAvailable()) localStorage.setItem(key, serialised);
  else memStore.set(key, serialised);
}
