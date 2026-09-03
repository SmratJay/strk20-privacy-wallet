import type { Account, RpcProvider } from "starknet";
import { verifyAccountOwnership } from "../ownership";
import { probeAccountDeployment } from "./ready";
import type {
  AccountAdapter,
  AccountDeployment,
  AccountDeploymentProbe,
  OwnershipVerification,
} from "./types";
import type { WalletNetworkId } from "../types";

/**
 * Wallet Core — Braavos account adapter.
 *
 * Braavos accounts are NOT counterfactually derivable from a public key alone: their address
 * depends on initialization parameters (guardian, hardware signer, multisig config) that are
 * not recoverable from a seed/key. Import therefore REQUIRES the user's existing account
 * address, and ownership is proven on-chain — not by derivation.
 *
 * Verified account configuration (queried live on Starknet Sepolia, 2026-09-03):
 *  - `braavos_account` class: 0x03957f…b8a  (declared; ABI includes get_public_key,
 *    get_signers, get_multisig_threshold, is_valid_signature, initializer, upgrade)
 *  - `braavos_base_account` class: 0x03d16c…201 (declared; base preset used at deployment,
 *    replaces class via `replace_class_syscall` on init)
 *
 * Because Braavos accounts self-upgrade (`replace_class_syscall`), the deployed class hash at an
 * address may legitimately differ from the pinned set over time. probeDeployment therefore
 * reports a nonzero class hash as deployed; the REAL assurance is ownership verification:
 *  1. `get_multisig_threshold` > 1 → fail closed (a single imported key cannot sign alone).
 *  2. `get_public_key` view must equal the derived public key.
 *  3. Fallback (older/upgraded layouts): SRC-5 `is_valid_signature` challenge.
 */

export const BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA =
  process.env.NEXT_PUBLIC_BRAAVOS_ACCOUNT_CLASSHASH ||
  "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";

export const BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA =
  process.env.NEXT_PUBLIC_BRAAVOS_BASE_CLASSHASH ||
  "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";

export interface BraavosNetworkConfig {
  supported: boolean;
  /** Known Braavos account class hashes on this network (verified). */
  accountClasses: string[];
}

/**
 * Per-network Braavos account configuration. Mainnet is NOT verified → `supported: false` so
 * we never claim Braavos works there. Sepolia is verified (class hashes above were confirmed
 * declared on-chain).
 */
export const BRAAVOS_ACCOUNT_CONFIG: Record<WalletNetworkId, BraavosNetworkConfig> = {
  sepolia: {
    supported: true,
    accountClasses: [BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA, BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA],
  },
  mainnet: { supported: false, accountClasses: [] },
};

export function isBraavosAccountSupported(network: WalletNetworkId): boolean {
  return BRAAVOS_ACCOUNT_CONFIG[network]?.supported === true;
}

export interface BraavosAccountAdapterOptions {
  publicKey: string;
  /** The user's EXISTING Braavos account address (never derived). */
  address: string;
  network: WalletNetworkId;
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("Braavos account address must be a 0x-prefixed hex value.");
  }
  return "0x" + BigInt(value).toString(16);
}

/**
 * Read a view function result from the account contract. Returns `null` when the call reverts
 * (entrypoint absent on an upgraded/older layout) — callers must then fail closed or fall back.
 */
async function readAccountView(
  provider: Pick<RpcProvider, "callContract">,
  address: string,
  entrypoint: string,
): Promise<bigint[] | null> {
  try {
    const response = await provider.callContract({ contractAddress: address, entrypoint, calldata: [] });
    const result = (response as { result?: unknown[] }).result ?? (response as unknown[]);
    return (result ?? []).map((r) => BigInt(String(r)));
  } catch {
    return null;
  }
}

export class BraavosAccountAdapter implements AccountAdapter {
  readonly type = "braavos-v1.2.0";
  readonly address: string;
  readonly publicKey: string;
  readonly addressDerivable = false;
  private readonly network: WalletNetworkId;

  constructor(options: BraavosAccountAdapterOptions) {
    const config = BRAAVOS_ACCOUNT_CONFIG[options.network];
    if (!config?.supported) {
      throw new Error(
        `Braavos account configuration is not verified on ${options.network}. Braavos import is not supported there.`,
      );
    }
    this.network = options.network;
    this.publicKey = options.publicKey;
    this.address = normalizeAddress(options.address);
  }

  probeDeployment(provider: Pick<RpcProvider, "getClassHashAt">): Promise<AccountDeploymentProbe> {
    return probeAccountDeployment(provider, this.address);
  }

  isDeployed(provider: Pick<RpcProvider, "getClassHashAt">): Promise<boolean> {
    return this.probeDeployment(provider).then((probe) => probe === "deployed");
  }

  /**
   * Ownership proof for an existing Braavos account. Fail closed unless the account is both
   * Braavos-family (known class OR passes the ownership checks below) and demonstrably
   * controlled by `publicKey`.
   */
  async verifyOwnership(account: Account, provider: RpcProvider): Promise<OwnershipVerification> {
    const deployed = await probeAccountDeployment(provider, this.address);
    if (deployed !== "deployed") {
      return {
        verified: false,
        method: "braavos-ownership",
        reason: "Account is not deployed on-chain; cannot verify ownership of an imported Braavos account.",
      };
    }

    // 1) Multisig accounts cannot be controlled by a single imported key.
    const threshold = await readAccountView(provider, this.address, "get_multisig_threshold");
    if (threshold !== null && threshold[0] > 1n) {
      return {
        verified: false,
        method: "braavos-get_multisig_threshold",
        reason: "This Braavos account is multisig (threshold > 1). A single imported key cannot sign alone.",
      };
    }

    // 2) Direct owner check: get_public_key must equal the derived public key.
    const owner = await readAccountView(provider, this.address, "get_public_key");
    if (owner !== null && owner.length > 0) {
      const ownerHex = "0x" + owner[0].toString(16);
      if (ownerHex.toLowerCase() === this.publicKey.toLowerCase()) {
        const classHash = await readClassHash(provider, this.address);
        return {
          verified: true,
          method: "braavos-get_public_key",
          observedClassHash: classHash ?? undefined,
        };
      }
      return {
        verified: false,
        method: "braavos-get_public_key",
        reason: "The account's on-chain public key does not match the imported key.",
      };
    }

    // 3) Fallback for upgraded/older layouts: SRC-5 signature challenge.
    const src5 = await verifyAccountOwnership(account, provider);
    if (src5.verified) {
      const classHash = await readClassHash(provider, this.address);
      return { ...src5, method: "braavos-is_valid_signature", observedClassHash: classHash ?? undefined };
    }
    return {
      verified: false,
      method: "braavos-is_valid_signature",
      reason: `Could not verify ownership: ${src5.reason ?? "unknown"}`,
    };
  }

  deploy(_account: Account): Promise<AccountDeployment> {
    throw new Error(
      "Braavos accounts are imported as existing, already-deployed accounts. Deployment is not supported.",
    );
  }

  waitForFinality(
    _provider: Pick<RpcProvider, "getBlockNumber">,
    _deployedAtBlock: number,
    _blocks?: number,
  ): Promise<number> {
    throw new Error("Braavos import never deploys; finality waiting is not applicable.");
  }
}

async function readClassHash(provider: Pick<RpcProvider, "getClassHashAt">, address: string): Promise<string | null> {
  try {
    return await provider.getClassHashAt(address);
  } catch {
    return null;
  }
}

export function isKnownBraavosClass(classHash: string, network: WalletNetworkId): boolean {
  const classes = BRAAVOS_ACCOUNT_CONFIG[network]?.accountClasses ?? [];
  return classes.some((c) => BigInt(c) === BigInt(classHash));
}