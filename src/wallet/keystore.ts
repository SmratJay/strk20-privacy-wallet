import { getPublicKey } from "./crypto";

/**
 * Wallet Core — encrypted keystore.
 *
 * The signing secret is persisted ONLY in an encrypted keystore. Encryption uses WebCrypto
 * primitives (no invented cryptography): PBKDF2 (SHA-256, ~250k iterations) derives a key from
 * the user's password, and AES-256-GCM authenticates + encrypts the secret. The password is
 * never stored; decryption fails loudly on a wrong password.
 *
 * The keystore intentionally carries the PUBLIC wallet state (publicKey, address, network,
 * accountType, createdAt) alongside the ciphertext so a single encrypted blob fully restores a
 * wallet. Public state is also mirrored in a separate unencrypted store (see storage.ts) for
 * session UX; the secret itself only ever lives inside `ciphertext`.
 */

export const KEYSTORE_VERSION = 1;
export const PBKDF2_ITERATIONS = 250_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export interface EncryptedKeystore {
  version: number;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string; // base64
  };
  cipher: {
    name: "AES-GCM";
    iv: string; // base64
    ciphertext: string; // base64
  };
  /** Public wallet state — never secret. */
  publicKey: string;
  address: string;
  network: string;
  accountType: string;
  createdAt: number;
}

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Wallet keystore requires WebCrypto (crypto.subtle), which is unavailable.");
  }
  return crypto.subtle;
}

function getRandomBytes(length: number): Uint8Array {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(length));
  }
  throw new Error("Wallet keystore requires a CSPRNG (crypto.getRandomValues).");
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveEncryptionKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a signing secret with a user password. Returns a fully self-contained keystore.
 */
export async function encryptSecret(
  secret: string,
  password: string,
  publicState: Pick<EncryptedKeystore, "publicKey" | "address" | "network" | "accountType">,
): Promise<EncryptedKeystore> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = getRandomBytes(SALT_BYTES);
  const iv = getRandomBytes(IV_BYTES);
  const key = await deriveEncryptionKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(secret) as unknown as BufferSource,
  );
  return {
    version: KEYSTORE_VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) },
    publicKey: publicState.publicKey,
    address: publicState.address,
    network: publicState.network,
    accountType: publicState.accountType,
    createdAt: Date.now(),
  };
}

/**
 * Decrypt a keystore with the user password. Returns the signing secret.
 *
 * AES-GCM authenticates the ciphertext, so a wrong password fails decryption and throws — the
 * caller must treat any throw here as "wrong password or tampered keystore".
 */
export async function decryptSecret(keystore: EncryptedKeystore, password: string): Promise<string> {
  if (keystore.version !== KEYSTORE_VERSION) {
    throw new Error(`Unsupported wallet keystore version: ${keystore.version}.`);
  }
  const key = await deriveEncryptionKey(password, fromBase64(keystore.kdf.salt), keystore.kdf.iterations);
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(keystore.cipher.iv) as unknown as BufferSource },
    key,
    fromBase64(keystore.cipher.ciphertext) as unknown as BufferSource,
  );
  const secret = new TextDecoder().decode(plain);
  // Sanity: the decrypted value must be a plausible secret deriving the recorded public key.
  const expected = getPublicKey(secret);
  if (expected.toLowerCase() !== keystore.publicKey.toLowerCase()) {
    throw new Error("Decrypted secret does not match the keystore public key.");
  }
  return secret;
}

/** Serialize a keystore to JSON. */
export function serializeKeystore(keystore: EncryptedKeystore): string {
  return JSON.stringify(keystore);
}

/** Parse a serialized keystore. Throws when the shape is invalid. */
export function deserializeKeystore(json: string): EncryptedKeystore {
  const parsed = JSON.parse(json) as EncryptedKeystore;
  if (
    parsed?.version !== KEYSTORE_VERSION ||
    !parsed?.cipher?.ciphertext ||
    !parsed?.cipher?.iv ||
    !parsed?.kdf?.salt ||
    !parsed?.publicKey ||
    !parsed?.address
  ) {
    throw new Error("Keystore is corrupt or not a wallet keystore.");
  }
  return parsed;
}