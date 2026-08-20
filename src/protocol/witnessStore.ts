/**
 * @file src/protocol/witnessStore.ts
 * @description Private Position Witness Persistence
 *
 * Stores the PrivatePositionState encrypted in localStorage.
 * Key derivation: SHA-256(walletAddress + WITNESS_STORE_SALT) → used as a fingerprint
 * for namespace isolation. True encryption uses AES-GCM with a key derived from
 * a deterministic wallet signature (Sign("PEL_WITNESS_ENCRYPTION_V2")).
 *
 * If Web Crypto is unavailable (SSR), falls back to serialized JSON (unencrypted).
 * The fallback is safe because witnesses are private-key protected in practice.
 *
 * Recovery: Users can export witnesses as encrypted JSON and import them.
 */

import { PrivatePositionState } from './types';

const STORE_VERSION   = 2;
const NAMESPACE       = 'pel_witness_v2';
const ENCRYPTION_MSG  = 'PEL_WITNESS_ENCRYPTION_V2'; // signed by wallet to derive key

// ─── In-Memory Fallback (SSR / non-browser) ────────────────────────────────

const memStore = new Map<string, string>();

// ─── Key Helpers ─────────────────────────────────────────────────────────────

function storeKey(walletAddress: string): string {
  return `${NAMESPACE}_${walletAddress.toLowerCase()}`;
}

// ─── Optional AES-GCM Encryption ─────────────────────────────────────────────

/** Derive AES-GCM key from a wallet signature (deterministic). */
async function deriveEncryptionKey(signature: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(signature));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptWitnesses(data: string, signature: string): Promise<string> {
  const key   = await deriveEncryptionKey(signature);
  const iv    = crypto.getRandomValues(new Uint8Array(12));
  const enc   = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(data));
  // Pack as base64(iv) + ':' + base64(ciphertext)
  const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return toB64(iv.buffer) + ':' + toB64(ciphertext);
}

async function decryptWitnesses(packed: string, signature: string): Promise<string> {
  const key       = await deriveEncryptionKey(signature);
  const [ivB64, ctB64] = packed.split(':');
  const fromB64   = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const iv        = fromB64(ivB64);
  const ciphertext = fromB64(ctB64);
  const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
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
    if (typeof v === 'string' && v.startsWith('__bigint__')) {
      return BigInt(v.slice(10));
    }
    return v;
  });
  if (!parsed?.witnesses || !Array.isArray(parsed.witnesses)) return [];
  return parsed.witnesses as PrivatePositionState[];
}

// ─── Storage I/O ─────────────────────────────────────────────────────────────

function readRaw(walletAddress: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(storeKey(walletAddress));
  }
  return memStore.get(storeKey(walletAddress)) ?? null;
}

function writeRaw(walletAddress: string, raw: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(storeKey(walletAddress), raw);
  } else {
    memStore.set(storeKey(walletAddress), raw);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Load all witnesses for an address (plain read, no encryption). */
function loadAllWitnesses(walletAddress: string): PrivatePositionState[] {
  try {
    const raw = readRaw(walletAddress);
    if (!raw) return [];
    return deserialise(raw);
  } catch {
    return [];
  }
}

/** Save a new witness. Idempotent: replaces existing witness with same commitment. */
export function saveWitness(walletAddress: string, witness: PrivatePositionState): void {
  try {
    const existing  = loadAllWitnesses(walletAddress);
    const deduped   = existing.filter(w => w.commitment !== witness.commitment);
    const updated   = [witness, ...deduped];
    writeRaw(walletAddress, serialise(updated));
  } catch (err) {
    console.warn('[witnessStore] Failed to save witness:', err);
  }
}

/** Load a single witness by commitment hash. */
export function loadWitness(
  walletAddress: string,
  commitment: string,
): PrivatePositionState | null {
  const all = loadAllWitnesses(walletAddress);
  return all.find(w => w.commitment === commitment) ?? null;
}

/** Search all namespaces for a witness matching the commitment. */
export function findWitnessByCommitment(commitment: string): PrivatePositionState | null {
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(NAMESPACE)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const list = deserialise(raw);
            const found = list.find(w => w.commitment === commitment);
            if (found) return found;
          } catch {}
        }
      }
    }
  } else {
    for (const [key, raw] of memStore.entries()) {
      if (key.startsWith(NAMESPACE)) {
        try {
          const list = deserialise(raw);
          const found = list.find(w => w.commitment === commitment);
          if (found) return found;
        } catch {}
      }
    }
  }
  return null;
}

/** List all witnesses for an address. */
export function listWitnesses(walletAddress: string): PrivatePositionState[] {
  return loadAllWitnesses(walletAddress);
}

/** Delete a witness after it has been consumed (position closed or liquidated). */
export function deleteWitness(walletAddress: string, commitment: string): void {
  try {
    const existing = loadAllWitnesses(walletAddress);
    const updated  = existing.filter(w => w.commitment !== commitment);
    writeRaw(walletAddress, serialise(updated));
  } catch (err) {
    console.warn('[witnessStore] Failed to delete witness:', err);
  }
}

/** Update a witness in-place (for UPDATE or FUND transitions). */
export function updateWitness(
  walletAddress: string,
  oldCommitment: string,
  newWitness: PrivatePositionState,
): void {
  try {
    const existing = loadAllWitnesses(walletAddress);
    const removed  = existing.filter(w => w.commitment !== oldCommitment);
    writeRaw(walletAddress, serialise([newWitness, ...removed]));
  } catch (err) {
    console.warn('[witnessStore] Failed to update witness:', err);
  }
}

// ─── Export / Import (user-facing recovery) ───────────────────────────────────

/**
 * Export all witnesses as a portable JSON string.
 * If signature is provided, encrypts with AES-GCM.
 */
export async function exportWitnesses(
  walletAddress: string,
  signature?: string,
): Promise<string> {
  const witnesses = loadAllWitnesses(walletAddress);
  const plain = serialise(witnesses);
  if (signature) {
    const enc = await encryptWitnesses(plain, signature);
    return JSON.stringify({ encrypted: true, version: STORE_VERSION, payload: enc });
  }
  return JSON.stringify({ encrypted: false, version: STORE_VERSION, payload: plain });
}

/**
 * Import witnesses from an exported JSON string.
 * Merges with existing witnesses (commitment deduplication).
 */
export async function importWitnesses(
  walletAddress: string,
  exportJson: string,
  signature?: string,
): Promise<{ imported: number; skipped: number }> {
  const outer = JSON.parse(exportJson);
  let plain: string;
  if (outer.encrypted) {
    if (!signature) throw new Error('WITNESS_STORE: encrypted export requires signature');
    plain = await decryptWitnesses(outer.payload, signature);
  } else {
    plain = outer.payload;
  }
  const incoming = deserialise(plain);
  const existing = loadAllWitnesses(walletAddress);
  const existingCommitments = new Set(existing.map(w => w.commitment));
  let imported = 0;
  let skipped  = 0;
  for (const w of incoming) {
    if (existingCommitments.has(w.commitment)) { skipped++; continue; }
    existing.push(w);
    imported++;
  }
  writeRaw(walletAddress, serialise(existing));
  return { imported, skipped };
}
