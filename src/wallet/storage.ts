/**
 * Wallet Core — storage model.
 *
 * Clear separation between PUBLIC and PRIVATE wallet state. They are never mixed:
 *
 *  PUBLIC WALLET STATE   — address, public key, network, deployment status, account type.
 *                          Safe to read/write without a password (session UX only).
 *  PRIVATE WALLET STATE  — the encrypted keystore (AES-GCM + PBKDF2). The ONLY persisted
 *                          artifact that can recover the signing secret. Never plaintext.
 *  PRIVACY STATE         — STRK20 viewing keys, notes, private balances. OUT OF SCOPE for the
 *                          wallet core; owned by the STRK20 privacy layer, never persisted here.
 */

export interface WalletStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage (tests, SSR). */
export function createMemoryStorage(): WalletStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

/** localStorage-backed storage with SSR guards. */
export function createBrowserStorage(): WalletStorage {
  const local =
    typeof localStorage !== "undefined" ? localStorage : null;
  return {
    getItem: (key) => (local ? local.getItem(key) : null),
    setItem: (key, value) => {
      if (local) local.setItem(key, value);
    },
    removeItem: (key) => {
      if (local) local.removeItem(key);
    },
  };
}

/** Default storage: localStorage in the browser, memory elsewhere. */
export function defaultStorage(): WalletStorage {
  return typeof localStorage !== "undefined" ? createBrowserStorage() : createMemoryStorage();
}

const PREFIX = "orrange_wallet";

/** PUBLIC wallet state record (never contains secrets). */
export interface PublicWalletState {
  accountType: string;
  address: string;
  publicKey: string;
  network: string;
  deploymentStatus: "not_deployed" | "pending" | "finalizing" | "deployed" | "error" | "unknown";
  createdAt: number;
}

function publicKeyFor(network: string): string {
  return `${PREFIX}_public_${network}`;
}

function keystoreKeyFor(network: string): string {
  return `${PREFIX}_keystore_${network}`;
}

export function readPublicState(storage: WalletStorage, network: string): PublicWalletState | null {
  const raw = storage.getItem(publicKeyFor(network));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublicWalletState;
  } catch {
    return null;
  }
}

export function writePublicState(storage: WalletStorage, network: string, state: PublicWalletState): void {
  storage.setItem(publicKeyFor(network), JSON.stringify(state));
}

export function updateDeploymentStatus(
  storage: WalletStorage,
  network: string,
  deploymentStatus: PublicWalletState["deploymentStatus"],
): void {
  const state = readPublicState(storage, network);
  if (state) {
    writePublicState(storage, network, { ...state, deploymentStatus });
  }
}

export function readKeystore(storage: WalletStorage, network: string): string | null {
  return storage.getItem(keystoreKeyFor(network));
}

export function writeKeystore(storage: WalletStorage, network: string, keystoreJson: string): void {
  storage.setItem(keystoreKeyFor(network), keystoreJson);
}

/** Remove ALL wallet state for a network. */
export function clearWallet(storage: WalletStorage, network: string): void {
  storage.removeItem(publicKeyFor(network));
  storage.removeItem(keystoreKeyFor(network));
}