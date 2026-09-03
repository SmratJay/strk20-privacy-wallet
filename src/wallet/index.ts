/**
 * Wallet Core — public surface.
 *
 * A self-custodial Starknet wallet whose native privacy layer is STRK20.
 *
 * Dependency direction:
 *
 *   UI
 *    ↓
 *   Wallet Core      (this module)
 *    ├── Key Management   → crypto.ts
 *    ├── Keystore         → keystore.ts (AES-GCM + PBKDF2, password-encrypted)
 *    ├── Account          → account/ (AccountAdapter seam → ReadyAccountAdapter)
 *    ├── Storage          → storage.ts (public vs private separation)
 *    └── Signing/Deploy   → walletCore.ts
 *
 *   STRK20 Privacy Core
 *    ↓
 *   Wallet Core signer    (an UnlockedWallet's account/signer)
 *
 * NOT: Wallet Core → STRK20, and NOT: Wallet Core → Privy.
 */
export { generateSecretKey, getPublicKey, canonicalizeSecret, verifySignature } from "./crypto";
export {
  encryptSecret,
  decryptSecret,
  serializeKeystore,
  deserializeKeystore,
  KEYSTORE_VERSION,
  type EncryptedKeystore,
} from "./keystore";
export {
  createWallet,
  unlockWallet,
  deployAccount,
  getDeploymentStatus,
  signTransaction,
  sendTransaction,
  exportSecret,
  clearWallet,
  lockWallet,
  type UnlockedWallet,
  type CreateWalletOptions,
  type UnlockWalletOptions,
  type WalletNetworkId,
  type WalletDeploymentStatus,
} from "./walletCore";
export {
  createMemoryStorage,
  createBrowserStorage,
  defaultStorage,
  readPublicState,
  writePublicState,
  readKeystore,
  writeKeystore,
  clearWallet as clearWalletStorage,
  type WalletStorage,
  type PublicWalletState,
} from "./storage";
export {
  ReadyAccountAdapter,
  computeReadyAccountAddress,
  isAccountDeployed,
  deployReadyAccount,
  waitForDeploymentFinality,
  READY_SEPOLIA_CLASS_HASH,
  type AccountAdapter,
  type AccountDeployment,
} from "./account";