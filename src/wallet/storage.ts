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

// ────────────────────────────────────────────────────────────────────────────────────────────
// Stage 2 — multi-wallet registry.
//
// Storage is scoped by WALLET IDENTITY + NETWORK (not just network) so an imported Ready/Braavos
// wallet can never overwrite another wallet. A wallet identity is its canonical account address
// (unique per account). The encrypted keystore lives under `orrange_wallet_v2_keystore_<walletId>`.
// The legacy single-wallet keys above are preserved for Stage 1 compatibility.
// ────────────────────────────────────────────────────────────────────────────────────────────

export const REGISTRY_PREFIX = "orrange_wallet_v2_registry";
export const WALLET_KEYSTORE_PREFIX = "orrange_wallet_v2_keystore";

/** Wallet identity = canonical (lowercased, unpadded) account address. */
export function walletIdFor(address: string): string {
  return "0x" + BigInt(address).toString(16);
}

export interface WalletRegistryEntry {
  walletId: string;
  accountType: string;
  address: string;
  publicKey: string;
  network: string;
  deploymentStatus: PublicWalletState["deploymentStatus"];
  createdAt: number;
  source: "created" | "imported";
}

function registryKeyFor(network: string): string {
  return `${REGISTRY_PREFIX}_${network}`;
}

function walletKeystoreKeyFor(walletId: string): string {
  return `${WALLET_KEYSTORE_PREFIX}_${walletId}`;
}

export function readWalletRegistry(storage: WalletStorage, network: string): WalletRegistryEntry[] {
  const raw = storage.getItem(registryKeyFor(network));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as WalletRegistryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeWalletRegistry(storage: WalletStorage, network: string, entries: WalletRegistryEntry[]): void {
  storage.setItem(registryKeyFor(network), JSON.stringify(entries));
}

/** Insert or update a registry entry, keyed by walletId (never duplicate/overwrite another wallet). */
export function upsertWalletRegistryEntry(storage: WalletStorage, network: string, entry: WalletRegistryEntry): void {
  const entries = readWalletRegistry(storage, network);
  const idx = entries.findIndex((e) => e.walletId === entry.walletId);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writeWalletRegistry(storage, network, entries);
}

export function removeWalletRegistryEntry(storage: WalletStorage, network: string, walletId: string): void {
  const entries = readWalletRegistry(storage, network).filter((e) => e.walletId !== walletId);
  writeWalletRegistry(storage, network, entries);
}

export function readWalletKeystore(storage: WalletStorage, walletId: string): string | null {
  return storage.getItem(walletKeystoreKeyFor(walletId));
}

export function writeWalletKeystore(storage: WalletStorage, walletId: string, keystoreJson: string): void {
  storage.setItem(walletKeystoreKeyFor(walletId), keystoreJson);
}

export function clearWalletById(storage: WalletStorage, network: string, walletId: string): void {
  removeWalletRegistryEntry(storage, network, walletId);
  storage.removeItem(walletKeystoreKeyFor(walletId));
}

/**
 * One-time migration: if the legacy Stage 1 wallet exists for `network` and the registry has no
 * entry for it, register it (keystore content copied to the walletId-scoped key). Returns the
 * migrated entry, or null when there is no legacy wallet. Never deletes legacy keys.
 */
export function migrateLegacyWallet(storage: WalletStorage, network: string): WalletRegistryEntry | null {
  const legacyPublic = readPublicState(storage, network);
  const legacyKeystore = readKeystore(storage, network);
  if (!legacyPublic || !legacyKeystore) return null;
  const walletId = walletIdFor(legacyPublic.address);
  const registry = readWalletRegistry(storage, network);
  if (registry.some((e) => e.walletId === walletId)) return registry.find((e) => e.walletId === walletId) ?? null;
  writeWalletKeystore(storage, walletId, legacyKeystore);
  const entry: WalletRegistryEntry = {
    walletId,
    accountType: legacyPublic.accountType,
    address: legacyPublic.address,
    publicKey: legacyPublic.publicKey,
    network,
    deploymentStatus: legacyPublic.deploymentStatus,
    createdAt: legacyPublic.createdAt,
    source: "created",
  };
  upsertWalletRegistryEntry(storage, network, entry);
  return entry;
}