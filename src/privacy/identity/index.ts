/**
 * Privacy Core — PrivateIdentity (REAL STRK20 shadow-account model).
 *
 * A wallet-level shadow identity: deterministic SDK shadow commitment + shadow address for
 * (owner, viewingKey, anonymizer, appName, nonce). Records are wallet + network scoped and never
 * carry secret material.
 */
export {
  createPrivateIdentity,
  retirePrivateIdentity,
  listPrivateIdentities,
  readPrivateIdentities,
  findPrivateIdentity,
  deriveShadowIdentity,
  validatePrivateIdentity,
  normalizeAppName,
  validateShadowNonce,
  createMemoryPrivateIdentityStorage,
  createBrowserPrivateIdentityStorage,
  PRIVATE_IDENTITY_STORE_PREFIX,
  type PrivateIdentity,
  type PrivateIdentityStatus,
  type CreatePrivateIdentityInput,
  type PrivateIdentityStorage,
} from "./PrivateIdentity";
export { buildStrk20User, type Strk20WalletUser } from "./strk20User";