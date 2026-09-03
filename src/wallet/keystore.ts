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

/** Acceptable PBKDF2 iteration band. Bounds reject absurd/tampered values before KDF work. */
export const MIN_PBKDF2_ITERATIONS = 100_000;
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

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

const HEX_RE = /^0x[0-9a-fA-F]+$/;

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** Decode base64 strictly (atob throws on malformed input). Returns null on failure. */
function tryDecodeBase64(value: unknown, expectedLength: number): Uint8Array | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const bytes = fromBase64(value);
    if (bytes.length !== expectedLength) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Validate every field of a keystore BEFORE any expensive PBKDF2 work. Rejects malformed or
 * tampered metadata (wrong version, wrong KDF/cipher names, out-of-band iterations, wrong
 * salt/IV lengths, missing ciphertext, malformed public key / address / network / account type).
 */
export function validateKeystore(parsed: unknown): asserts parsed is EncryptedKeystore {
  const k = parsed as EncryptedKeystore | null;
  if (k === null || typeof k !== "object") {
    throw new Error("Keystore is not an object.");
  }
  if (k.version !== KEYSTORE_VERSION) {
    throw new Error(`Unsupported wallet keystore version: ${String(k.version)}.`);
  }
  if (k.kdf?.name !== "PBKDF2" || k.kdf?.hash !== "SHA-256") {
    throw new Error("Keystore uses an unsupported KDF configuration.");
  }
  if (
    typeof k.kdf.iterations !== "number" ||
    !Number.isInteger(k.kdf.iterations) ||
    k.kdf.iterations < MIN_PBKDF2_ITERATIONS ||
    k.kdf.iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new Error(
      `Keystore PBKDF2 iterations out of allowed range [${MIN_PBKDF2_ITERATIONS}, ${MAX_PBKDF2_ITERATIONS}].`,
    );
  }
  if (tryDecodeBase64(k.kdf.salt, SALT_BYTES) === null) {
    throw new Error(`Keystore salt must be a base64 value of exactly ${SALT_BYTES} bytes.`);
  }
  if (k.cipher?.name !== "AES-GCM") {
    throw new Error("Keystore uses an unsupported cipher.");
  }
  if (tryDecodeBase64(k.cipher.iv, IV_BYTES) === null) {
    throw new Error(`Keystore IV must be a base64 value of exactly ${IV_BYTES} bytes.`);
  }
  if (typeof k.cipher.ciphertext !== "string" || k.cipher.ciphertext.length < 8) {
    throw new Error("Keystore is missing an encrypted payload.");
  }
  if (!isHex(k.publicKey) || BigInt(k.publicKey) <= 0n) {
    throw new Error("Keystore has a malformed public key.");
  }
  if (!isHex(k.address) || BigInt(k.address) <= 0n) {
    throw new Error("Keystore has a malformed account address.");
  }
  if (typeof k.network !== "string" || k.network.length === 0 || k.network.length > 32) {
    throw new Error("Keystore has a malformed network.");
  }
  if (typeof k.accountType !== "string" || k.accountType.length === 0 || k.accountType.length > 64) {
    throw new Error("Keystore has a malformed account type.");
  }
  if (typeof k.createdAt !== "number" || !Number.isFinite(k.createdAt) || k.createdAt <= 0) {
    throw new Error("Keystore has a malformed creation timestamp.");
  }
}

/**
 * Decrypt a keystore with the user password. Returns the signing secret.
 *
 * AES-GCM authenticates the ciphertext, so a wrong password fails decryption and throws — the
 * caller must treat any throw here as "wrong password or tampered keystore".
 */
export async function decryptSecret(keystore: EncryptedKeystore, password: string): Promise<string> {
  validateKeystore(keystore);
  const salt = fromBase64(keystore.kdf.salt);
  const iv = fromBase64(keystore.cipher.iv);
  const key = await deriveEncryptionKey(password, salt, keystore.kdf.iterations);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: iv as unknown as BufferSource },
        key,
        fromBase64(keystore.cipher.ciphertext) as unknown as BufferSource,
      ),
    );
  } catch {
    // AES-GCM authenticates the ciphertext: a wrong password (or tampered keystore) fails here.
    // Report it as the clear, honest cause instead of leaking the underlying crypto error.
    throw new Error("Incorrect password or corrupted keystore.");
  }
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

/** Parse + validate a serialized keystore. Throws before any KDF work when the shape is invalid. */
export function deserializeKeystore(json: string): EncryptedKeystore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Keystore is not valid JSON.");
  }
  validateKeystore(parsed);
  return parsed;
}