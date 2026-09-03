/**
 * @file walletCore.test.ts
 * @description Stage 1 — Own Wallet Core tests. Covers the 12 required areas:
 *   1. key generation, 2. deterministic public-key derivation, 3. account address derivation,
 *   4. wallet encryption/decryption, 5. incorrect password rejection, 6. wallet reload,
 *   7. valid Starknet signatures, 8. account adapter without Privy, 9. deployment flow,
 *   10. transaction signing/submission, 11. no plaintext secret persistence,
 *   12. Privy not required by WalletCore.
 */

import { describe, it, expect, vi } from "vitest";
import { typedData, Signer } from "starknet";
import type { Call } from "starknet";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalizeSecret,
  generateSecretKey,
  getPublicKey,
  verifySignature,
} from "../wallet/crypto";
import {
  decryptSecret,
  deserializeKeystore,
  encryptSecret,
  serializeKeystore,
} from "../wallet/keystore";
import {
  computeReadyAccountAddress,
  deployReadyAccount,
  isAccountDeployed,
  ReadyAccountAdapter,
} from "../wallet/account";
import {
  createMemoryStorage,
  readKeystore,
  readPublicState,
} from "../wallet/storage";
import {
  createWallet,
  deployAccount,
  getDeploymentStatus,
  sendTransaction,
  unlockWallet,
  exportSecret,
} from "../wallet/walletCore";

const PASSWORD = "correct horse battery staple";

/** Sign a typed-data message and return the computed msgHash + [r, s] for cryptographic verify. */
async function signMessage(signer: Signer, accountAddress: string) {
  const typedDataPayload = {
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      Message: [{ name: "message", type: "felt" }],
    },
    primaryType: "Message",
    domain: { name: "ORRANGE", version: "1", chainId: 1 },
    message: { message: "self-custodial wallet core" },
  };
  const msgHash = typedData.getMessageHash(typedDataPayload, accountAddress);
  const sig = (await signer.signMessage(typedDataPayload, accountAddress)) as unknown as {
    r: bigint;
    s: bigint;
  };
  return {
    msgHash,
    signature: ["0x" + sig.r.toString(16), "0x" + sig.s.toString(16)] as [string, string],
  };
}

describe("1. key generation", () => {
  it("generates a canonical 0x-prefixed STARK secret", () => {
    const secret = generateSecretKey();
    expect(secret).toMatch(/^0x[0-9a-f]+$/);
    const scalar = BigInt(secret);
    expect(scalar).toBeGreaterThan(0n);
    expect(scalar).toBeLessThan(ecCurveOrder());
  });

  it("generates distinct secrets on repeated calls", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    expect(a).not.toBe(b);
  });

  it("canonicalizes a secret into the account-acceptable range", () => {
    const n = ecCurveOrder();
    const upperHalf = "0x" + (n - 2n).toString(16);
    const canonical = canonicalizeSecret(upperHalf);
    expect(BigInt(canonical)).toBeLessThanOrEqual(n / 2n);
    // Reflection derives the SAME public key x-coordinate.
    expect(getPublicKey(upperHalf)).toBe(getPublicKey(canonical));
  });
});

describe("2. deterministic public-key derivation", () => {
  it("derives the same public key for the same secret", () => {
    const secret = generateSecretKey();
    expect(getPublicKey(secret)).toBe(getPublicKey(secret));
  });

  it("matches starknet.js Signer.getPubKey", async () => {
    const secret = generateSecretKey();
    const signer = new Signer(secret);
    expect(getPublicKey(secret).toLowerCase()).toBe((await signer.getPubKey()).toLowerCase());
  });

  it("derives different public keys for different secrets", () => {
    expect(getPublicKey(generateSecretKey())).not.toBe(getPublicKey(generateSecretKey()));
  });
});

describe("3. account address derivation", () => {
  it("is deterministic for a public key", () => {
    const pk = getPublicKey(generateSecretKey());
    expect(computeReadyAccountAddress(pk)).toBe(computeReadyAccountAddress(pk));
  });

  it("matches the ReadyAccountAdapter address", () => {
    const pk = getPublicKey(generateSecretKey());
    const adapter = new ReadyAccountAdapter(pk);
    expect(adapter.address.toLowerCase()).toBe(computeReadyAccountAddress(pk).toLowerCase());
    expect(adapter.publicKey.toLowerCase()).toBe(pk.toLowerCase());
    expect(adapter.type).toMatch(/^ready/);
  });
});

describe("4. wallet encryption / decryption", () => {
  it("round-trips a secret through encryptSecret/decryptSecret", async () => {
    const secret = generateSecretKey();
    const keystore = await encryptSecret(secret, PASSWORD, {
      publicKey: getPublicKey(secret),
      address: "0xabc",
      network: "sepolia",
      accountType: "ready-v0.4.0",
    });
    expect(await decryptSecret(keystore, PASSWORD)).toBe(secret);
  });

  it("serialize/deserialize round-trips", async () => {
    const secret = generateSecretKey();
    const keystore = await encryptSecret(secret, PASSWORD, {
      publicKey: getPublicKey(secret),
      address: "0xabc",
      network: "sepolia",
      accountType: "ready-v0.4.0",
    });
    const restored = deserializeKeystore(serializeKeystore(keystore));
    expect(restored).toEqual(keystore);
    expect(await decryptSecret(restored, PASSWORD)).toBe(secret);
  });

  it("rejects a short password", async () => {
    await expect(
      encryptSecret(generateSecretKey(), "short", {
        publicKey: "0x1",
        address: "0xabc",
        network: "sepolia",
        accountType: "ready-v0.4.0",
      }),
    ).rejects.toThrow(/8 characters/);
  });
});

describe("5. incorrect password rejection", () => {
  it("throws when decrypting with the wrong password", async () => {
    const secret = generateSecretKey();
    const keystore = await encryptSecret(secret, PASSWORD, {
      publicKey: getPublicKey(secret),
      address: "0xabc",
      network: "sepolia",
      accountType: "ready-v0.4.0",
    });
    await expect(decryptSecret(keystore, "wrong-password-123")).rejects.toThrow();
  });

  it("unlockWallet rejects a wrong password", async () => {
    const storage = createMemoryStorage();
    await createWallet({ network: "sepolia", password: PASSWORD, storage });
    await expect(
      unlockWallet({ network: "sepolia", password: "wrong-password-123", storage }),
    ).rejects.toThrow();
  });
});

describe("6. wallet reload (create → unlock)", () => {
  it("restores the same address, public key, and secret", async () => {
    const storage = createMemoryStorage();
    const created = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const reloaded = await unlockWallet({ network: "sepolia", password: PASSWORD, storage });
    expect(reloaded.address).toBe(created.address);
    expect(reloaded.publicKey).toBe(created.publicKey);
    expect(reloaded.secret).toBe(created.secret);
    expect(reloaded.accountType).toBe(created.accountType);
  });

  it("verifies address/public-key relationship on unlock (tamper detection)", async () => {
    const storage = createMemoryStorage();
    await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const raw = readKeystore(storage, "sepolia")!;
    const keystore = deserializeKeystore(raw);
    // Tamper with the recorded address → unlock must fail.
    keystore.address = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const { writeKeystore } = await import("../wallet/storage");
    writeKeystore(storage, "sepolia", serializeKeystore(keystore));
    await expect(
      unlockWallet({ network: "sepolia", password: PASSWORD, storage }),
    ).rejects.toThrow(/mismatch/);
  });

  it("fails to unlock when no wallet exists", async () => {
    await expect(
      unlockWallet({ network: "mainnet", password: PASSWORD, storage: createMemoryStorage() }),
    ).rejects.toThrow(/Create one first/);
  });
});

describe("7. signer produces valid Starknet signatures", () => {
  it("signs a message and the signature cryptographically verifies", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const signature = await signMessage(wallet.signer, wallet.address);
    expect(verifySignature(signature.msgHash, signature.signature, wallet.publicKey)).toBe(true);
  });

  it("re-signing the same payload is deterministic", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const a = await signMessage(wallet.signer, wallet.address);
    const b = await signMessage(wallet.signer, wallet.address);
    expect(a.signature).toEqual(b.signature);
  });

  it("the signer's public key matches the wallet public key", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    expect((await wallet.signer.getPubKey()).toLowerCase()).toBe(wallet.publicKey.toLowerCase());
  });
});

describe("8. account adapter works without Privy", () => {
  it("builds a local-signer account through ReadyAccountAdapter", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    expect(wallet.account.address.toLowerCase()).toBe(wallet.adapter.address.toLowerCase());
    expect(wallet.account.signer).toBeDefined();
    // The account's signer must sign locally (no server/Privy delegation) and verify.
    const signature = await signMessage(wallet.signer, wallet.address);
    expect(verifySignature(signature.msgHash, signature.signature, wallet.publicKey)).toBe(true);
  });

  it("isAccountDeployed fails closed on RPC errors", async () => {
    const provider = {
      getClassHashAt: vi.fn(async () => {
        throw new Error("Contract not found");
      }),
    };
    expect(await isAccountDeployed(provider as any, "0xabc")).toBe(false);
  });
});

describe("9. deployment flow", () => {
  it("deploys via DEPLOY_ACCOUNT with the local signer and updates state", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });

    // Mock the on-chain boundary: not deployed → deploySelf succeeds → finality reached.
    wallet.provider.getClassHashAt = vi.fn(async () => {
      throw new Error("Requested contract address is not deployed");
    }) as any;
    const deploySelf = vi.fn(async (_payload: unknown) => ({
      transaction_hash: "0xtxdeploy",
      contract_address: wallet.address,
    }));
    wallet.account.deploySelf = deploySelf as any;
    wallet.provider.waitForTransaction = vi.fn(async () => ({
      execution_status: "SUCCEEDED",
      status: "ACCEPTED_ON_L2",
      block_number: 123,
    })) as any;
    wallet.provider.getBlockNumber = vi.fn(async () => 133) as any;

    const result = await deployAccount(wallet, storage);

    expect(deploySelf).toHaveBeenCalledTimes(1);
    const payload = deploySelf.mock.calls[0][0] as { addressSalt?: string; contractAddress?: string };
    expect(payload.addressSalt).toBe(wallet.publicKey);
    expect(payload.contractAddress).toBe(wallet.address);
    expect(result.transactionHash).toBe("0xtxdeploy");
    expect(readPublicState(storage, "sepolia")?.deploymentStatus).toBe("deployed");
  });

  it("returns early when already deployed", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    wallet.provider.getClassHashAt = vi.fn(async () => "0x123") as any;
    wallet.account.deploySelf = vi.fn() as any;
    const result = await deployAccount(wallet, storage);
    expect(result.transactionHash).toBe("");
    expect(wallet.account.deploySelf).not.toHaveBeenCalled();
  });

  it("getDeploymentStatus reconciles against the chain", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    wallet.provider.getClassHashAt = vi.fn(async () => "0x123") as any;
    expect(await getDeploymentStatus(wallet, storage)).toBe("deployed");
    wallet.provider.getClassHashAt = vi.fn(async () => {
      throw new Error("not deployed");
    }) as any;
    expect(await getDeploymentStatus(wallet, storage)).toBe("not_deployed");
  });
});

describe("10. transaction signing / submission", () => {
  it("sendTransaction submits through the local-signer account and returns a hash", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const execute = vi.fn(async (_calls: unknown) => ({ transaction_hash: "0xtxsubmit" }));
    (wallet.account as any).execute = execute;

    const call: Call = {
      contractAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      entrypoint: "transfer",
      calldata: ["0x1", "0x2", "0x0", "0x3"],
    };
    const result = await sendTransaction(wallet, call);
    expect(result.transactionHash).toBe("0xtxsubmit");
    expect(execute).toHaveBeenCalledTimes(1);
    // The account executed the call array we passed.
    expect(execute.mock.calls[0][0]).toEqual([call]);
  });

  it("exportSecret returns the raw secret only with the correct password", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    expect(await exportSecret(wallet, PASSWORD)).toBe(wallet.secret);
    await expect(exportSecret(wallet, "wrong-password-123")).rejects.toThrow();
  });
});

describe("11. secrets are not persisted in plaintext", () => {
  it("never stores the raw secret or public state with it", async () => {
    const storage = createMemoryStorage();
    const wallet = await createWallet({ network: "sepolia", password: PASSWORD, storage });

    const keystoreJson = readKeystore(storage, "sepolia")!;
    expect(keystoreJson).not.toContain(wallet.secret);

    const publicState = readPublicState(storage, "sepolia")!;
    const publicJson = JSON.stringify(publicState);
    expect(publicJson).not.toContain(wallet.secret);

    // The ciphertext must be opaque (encrypted), never the plaintext secret.
    const keystore = deserializeKeystore(keystoreJson);
    expect(keystore.cipher.ciphertext).not.toContain(wallet.secret);
  });
});

describe("12. Privy is not required by WalletCore", () => {
  it("wallet modules never import Privy, external wallets, or Wallet API code", () => {
    const walletDir = join(__dirname, "..", "wallet");
    const forbidden = [
      "@privy-io",
      "@/privacy/privy",
      "@/privacy/adapter",
      "@/context/PrivyWalletContext",
      "@/hooks/useStarknetWallet",
      "@/services/strk20WalletApiService",
      "get-starknet",
    ];
    const files = walk(walletDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect(source, `${file} must not import ${needle}`).not.toContain(needle);
      }
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function ecCurveOrder(): bigint {
  // STARK curve order (canonical constant, independent of imports).
  return 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
}