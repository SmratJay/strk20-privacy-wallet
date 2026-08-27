import { strk20Crypto, UTXONote } from './strk20Crypto';
import { normalizeNetworkId } from '../config/networks';
import { num } from 'starknet';

const VAULT_STORAGE_PREFIX = 'strk20_vault';

// In-memory fallback for testing / SSR
const memoryStorage = new Map<string, string>();

export class VaultService {
  // NOTE: This vault is a LOCAL PROTOTYPE. It stores unspent-note bookkeeping in
  // browser storage for the UI only — it is NOT a real STRK20 shielded note store and
  // provides NO on-chain privacy. The authoritative shielded-note state lives on-chain
  // via the STRK20 privacy SDK (src/services/strk20SdkService.ts). Do not present this
  // local vault as a real privacy layer.

  public getStorageKey(address: string, networkId: string): string {
    const normalizedAddress = address.toLowerCase();
    const canonicalNetwork = normalizeNetworkId(networkId);
    return `${VAULT_STORAGE_PREFIX}_${normalizedAddress}_${canonicalNetwork}`;
  }

  private getItem(key: string): string | null {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch {}
    }
    return memoryStorage.get(key) || null;
  }

  private setItem(key: string, value: string): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, value);
        return;
      } catch {}
    }
    memoryStorage.set(key, value);
  }

  private removeItem(key: string): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
    memoryStorage.delete(key);
  }

  /**
   * Get all recorded UTXO notes for a specific wallet and network
   */
  getNotes(address: string, networkId: string): UTXONote[] {
    if (!address) return [];
    try {
      const key = this.getStorageKey(address, networkId);
      const raw = this.getItem(key);
      if (!raw) return [];
      const parsed: any[] = JSON.parse(raw);
      return parsed.map((n) => ({
        ...n,
        amount: BigInt(n.amount.toString()),
      }));
    } catch (err) {
      console.warn('Could not read vault notes:', err);
      return [];
    }
  }

  /**
   * Get total unspent shielded balance for a given token
   */
  getUnspentShieldedBalance(address: string, tokenAddress: string, networkId: string): bigint {
    const notes = this.getNotes(address, networkId);
    const tokenNormalized = tokenAddress.toLowerCase();

    return notes
      .filter((n) => !n.isSpent && n.tokenAddress.toLowerCase() === tokenNormalized)
      .reduce((acc, note) => acc + note.amount, 0n);
  }

  /**
   * Add a newly shielded note to the vault
   */
  addNote(
    address: string,
    networkId: string,
    tokenAddress: string,
    tokenSymbol: string,
    amountBigInt: bigint,
    txHash: string,
    viewingPrivateKey?: string,
    viewingPublicKey?: string,
    poolAddress?: string
  ): UTXONote {
    const notes = this.getNotes(address, networkId);
    const nextIndex = notes.length;

    // A local-prototype note. The viewing key must be provided by the caller (derived
    // from a wallet signature, NOT the public address). If absent, use a fresh random
    // channel key so the note is never keyed by public address.
    let privKey = viewingPrivateKey;
    let pubKey = viewingPublicKey;

    if (!privKey || !pubKey) {
      const bytes = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else require('crypto').randomBytes(bytes.length).forEach((b: number, i: number) => (bytes[i] = b));
      const randomKey = '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      privKey = randomKey;
      pubKey = randomKey;
    }

    const pool = poolAddress || '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';

    const channelKey = strk20Crypto.deriveChannelKeyECDH(
      privKey,
      pubKey,
      address,
      pool
    );

    const noteId = strk20Crypto.computeNoteId(channelKey, tokenAddress, nextIndex);
    const nullifier = strk20Crypto.computeNullifier(channelKey, tokenAddress, nextIndex, privKey);
    const salt = num.toHex(Date.now() * 1000 + nextIndex);

    const newNote: UTXONote = {
      noteId,
      channelKey,
      tokenAddress,
      tokenSymbol,
      index: nextIndex,
      salt,
      amount: amountBigInt,
      nullifier,
      isSpent: false,
      blockNumber: 0, // local prototype: block number is not authoritative
      timestamp: Date.now(),
      txHash,
    };

    const updated = [newNote, ...notes];
    this.saveNotes(address, networkId, updated);
    return newNote;
  }

  /**
   * Mark notes as spent when executing a private transfer or unshield
   */
  spendNotes(address: string, tokenAddress: string, amountToSpend: bigint, networkId: string): UTXONote[] {
    const notes = this.getNotes(address, networkId);
    const tokenNormalized = tokenAddress.toLowerCase();

    const available = notes
      .filter((n) => !n.isSpent && n.tokenAddress.toLowerCase() === tokenNormalized)
      .reduce((acc, n) => acc + n.amount, 0n);

    if (available < amountToSpend) {
      throw new Error(`INSUFFICIENT_SHIELDED_BALANCE: Required ${amountToSpend}, available ${available}`);
    }

    let remaining = amountToSpend;
    const updated = notes.map((note) => {
      if (!note.isSpent && note.tokenAddress.toLowerCase() === tokenNormalized && remaining > 0n) {
        if (note.amount <= remaining) {
          remaining -= note.amount;
          return { ...note, isSpent: true };
        } else {
          // Note is partially spent -> split note
          const leftover = note.amount - remaining;
          remaining = 0n;
          return { ...note, amount: leftover };
        }
      }
      return note;
    });

    this.saveNotes(address, networkId, updated);
    return updated;
  }

  /**
   * Mark notes as spent when allocating margin to a private perpetual position
   * Invariant (P0-01, P0-03, P1-11):
   * 1. Requires sufficient unspent balance of the designated collateral token (USDC).
   * 2. Preserves note's original STRK20 nullifier domain (`note.nullifier`).
   * 3. Stores position margin nullifier in `spentForPositionNullifier`.
   * 4. Is idempotent if re-called with the same marginNullifier.
   */
  spendNotesForMargin(
    address: string,
    networkId: string,
    amountToSpend: bigint,
    marginNullifier: string,
    tokenAddress?: string
  ): UTXONote[] {
    const notes = this.getNotes(address, networkId);

    // Check if this margin nullifier was already processed (idempotency)
    const alreadySpent = notes.some(
      (n) => n.isSpent && n.spentForPositionNullifier === marginNullifier
    );
    if (alreadySpent) {
      return notes;
    }

    const tokenNormalized = tokenAddress ? tokenAddress.toLowerCase() : undefined;

    const totalUnspent = notes
      .filter((n) => !n.isSpent && (!tokenNormalized || n.tokenAddress.toLowerCase() === tokenNormalized))
      .reduce((acc, n) => acc + n.amount, 0n);

    if (totalUnspent < amountToSpend) {
      throw new Error(
        `INSUFFICIENT_SHIELDED_BALANCE: Required ${amountToSpend}, available ${totalUnspent}${
          tokenAddress ? ` for token ${tokenAddress}` : ''
        }`
      );
    }

    let remaining = amountToSpend;
    const updated = notes.map((note) => {
      const matchToken = !tokenNormalized || note.tokenAddress.toLowerCase() === tokenNormalized;
      if (!note.isSpent && matchToken && remaining > 0n) {
        if (note.amount <= remaining) {
          remaining -= note.amount;
          return {
            ...note,
            isSpent: true,
            spentForPositionNullifier: marginNullifier, // Retain note.nullifier cleanly
          };
        } else {
          const leftover = note.amount - remaining;
          remaining = 0n;
          return { ...note, amount: leftover };
        }
      }
      return note;
    });

    this.saveNotes(address, networkId, updated);
    return updated;
  }

  /**
   * Save notes to persistent storage
   */
  private saveNotes(address: string, networkId: string, notes: UTXONote[]): void {
    try {
      const key = this.getStorageKey(address, networkId);
      const serializable = notes.map((n) => ({
        ...n,
        amount: n.amount.toString(),
      }));
      this.setItem(key, JSON.stringify(serializable));
    } catch (err) {
      console.warn('Could not save vault notes:', err);
    }
  }

  /**
   * Clear all notes for an address
   */
  clearVault(address: string, networkId: string): void {
    try {
      const key = this.getStorageKey(address, networkId);
      this.removeItem(key);
    } catch {}
  }
}

export const vaultService = new VaultService();
