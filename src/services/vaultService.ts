import { strk20Crypto, UTXONote } from './strk20Crypto';
import { viewingKeyService } from './viewingKeyService';
import { num } from 'starknet';

const VAULT_STORAGE_PREFIX = 'strk20_vault';

// In-memory fallback for testing / SSR
const memoryStorage = new Map<string, string>();

export class VaultService {
  private getStorageKey(address: string, networkId: string): string {
    const normalized = address.toLowerCase();
    return `${VAULT_STORAGE_PREFIX}_${normalized}_${networkId}`;
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

    // Use derived viewing key if available, otherwise derive from address
    let privKey = viewingPrivateKey;
    let pubKey = viewingPublicKey;

    if (!privKey || !pubKey) {
      const derived = viewingKeyService.deriveViewingKeyFromSignature(address);
      privKey = derived.privateViewingKey;
      pubKey = derived.publicViewingKey;
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
      blockNumber: 13540000 + nextIndex,
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
   * Invariant: Requires sufficient unspent balance and preserves note's STRK20 nullifier domain.
   */
  spendNotesForMargin(address: string, networkId: string, amountToSpend: bigint, marginNullifier: string): UTXONote[] {
    const notes = this.getNotes(address, networkId);

    const totalUnspent = notes
      .filter((n) => !n.isSpent)
      .reduce((acc, n) => acc + n.amount, 0n);

    if (totalUnspent < amountToSpend) {
      throw new Error(`INSUFFICIENT_SHIELDED_BALANCE: Required ${amountToSpend}, available ${totalUnspent}`);
    }

    let remaining = amountToSpend;
    const updated = notes.map((note) => {
      if (!note.isSpent && remaining > 0n) {
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
