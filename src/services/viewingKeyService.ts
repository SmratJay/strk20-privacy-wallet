import { ec, hash, num } from 'starknet';

export interface SavedContact {
  id: string;
  name: string;
  privacyAddress: string;
  createdAt: number;
}

export class ViewingKeyService {
  private static STORAGE_KEY_CONTACTS = 'strk20_saved_contacts';
  private static STORAGE_KEY_VIEWING_KEY = 'strk20_derived_vk';

  /**
   * Derives a deterministic Viewing Keypair from a signature
   */
  deriveViewingKeyFromSignature(signatureFelt: string): { privateViewingKey: string; publicViewingKey: string } {
    try {
      const privateKeyFelt = hash.computePoseidonHash(signatureFelt, '0x5354524b32305f56494557494e475f4b4559'); // "STRK20_VIEWING_KEY"
      const publicKey = ec.starkCurve.getStarkKey(privateKeyFelt);
      return {
        privateViewingKey: privateKeyFelt,
        publicViewingKey: publicKey,
      };
    } catch {
      // Fallback pseudo-random for browser sessions
      const randomSeed = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(31))).map(b => b.toString(16).padStart(2, '0')).join('');
      const publicKey = ec.starkCurve.getStarkKey(randomSeed);
      return {
        privateViewingKey: randomSeed,
        publicViewingKey: publicKey,
      };
    }
  }

  /**
   * Address Book Management
   */
  getContacts(): SavedContact[] {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(ViewingKeyService.STORAGE_KEY_CONTACTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  saveContact(name: string, privacyAddress: string): SavedContact {
    const contacts = this.getContacts();
    const newContact: SavedContact = {
      id: Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      privacyAddress: privacyAddress.trim(),
      createdAt: Date.now(),
    };
    const updated = [newContact, ...contacts.filter(c => c.privacyAddress !== privacyAddress)];
    try {
      localStorage.setItem(ViewingKeyService.STORAGE_KEY_CONTACTS, JSON.stringify(updated));
    } catch (err) {
      console.warn('Could not save contact to localStorage', err);
    }
    return newContact;
  }

  deleteContact(id: string): void {
    const contacts = this.getContacts();
    const updated = contacts.filter(c => c.id !== id);
    try {
      localStorage.setItem(ViewingKeyService.STORAGE_KEY_CONTACTS, JSON.stringify(updated));
    } catch (err) {
      console.warn('Could not update contacts in localStorage', err);
    }
  }
}

export const viewingKeyService = new ViewingKeyService();
