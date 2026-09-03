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
 *    ├── Account          → account/ (AccountAdapter seam → Ready + Braavos adapters)
 *    ├── Ownership        → ownership.ts (SRC-5 on-chain verification)
 *    ├── Storage          → storage.ts (public vs private; multi-wallet registry)
 *    ├── Amounts          → amount.ts (exact decimal parsing)
 *    ├── Import           → walletCore.importWallet (existing Ready/Braavos accounts)
 *    └── Signing/Deploy   → walletCore.ts
 *
 *   STRK20 Privacy Core
 *    ↓
 *   Wallet Core signer    (an UnlockedWallet's account/signer)
 *
 * NOT: Wallet Core → STRK20, and NOT: Wallet Core → Privy.
 */
export type { WalletNetworkId } from "./types";
export { generateSecretKey, getPublicKey, canonicalizeSecret, verifySignature } from "./crypto";
export { parseAmountToBase } from "./amount";
export {
  encryptSecret,
  decryptSecret,
  serializeKeystore,
  deserializeKeystore,
  validateKeystore,
  KEYSTORE_VERSION,
  PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  type EncryptedKeystore,
} from "./keystore";
export {
  createWallet,
  unlockWallet,
  importWallet,
  deployAccount,
  getDeploymentStatus,
  signTransaction,
  sendTransaction,
  exportSecret,
  clearWallet,
  lockWallet,
  listWallets,
  isAccountTypeSupported,
  type UnlockedWallet,
  type CreateWalletOptions,
  type UnlockWalletOptions,
  type ImportWalletOptions,
  type ImportResult,
  type DeployAccountResult,
  type DeployAccountOptions,
  type WalletAccountType,
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
  readWalletRegistry,
  writeWalletRegistry,
  upsertWalletRegistryEntry,
  removeWalletRegistryEntry,
  readWalletKeystore,
  writeWalletKeystore,
  clearWalletById,
  migrateLegacyWallet,
  walletIdFor,
  scopedWalletIdFor,
  clearWallet as clearWalletStorage,
  type WalletStorage,
  type PublicWalletState,
  type WalletRegistryEntry,
} from "./storage";
export {
  verifyAccountOwnership,
  callIsValidSignature,
  OWNERSHIP_CHALLENGE,
  ownershipChallengeHash,
  type OwnershipVerification as OwnershipVerificationResult,
} from "./ownership";
export {
  ReadyAccountAdapter,
  READY_ACCOUNT_CONFIG,
  isReadyAccountSupported,
  computeReadyAccountAddress,
  isAccountDeployed,
  probeAccountDeployment,
  deployReadyAccount,
  waitForDeploymentFinality,
  READY_SEPOLIA_CLASS_HASH,
  BraavosAccountAdapter,
  BRAAVOS_ACCOUNT_CONFIG,
  isBraavosAccountSupported,
  isKnownBraavosClass,
  BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA,
  BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA,
  type AccountAdapter,
  type AccountDeployment,
  type AccountDeploymentProbe,
  type OwnershipVerification,
  type BraavosAccountAdapterOptions,
} from "./account";