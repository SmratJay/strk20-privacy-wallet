import {
  CallData,
  CairoCustomEnum,
  CairoOption,
  CairoOptionVariant,
  hash,
} from "starknet";
import type { Account, RpcProvider } from "starknet";
import type { WalletNetworkId } from "../types";
import type { AccountAdapter, AccountDeployment, AccountDeploymentProbe } from "./types";

/**
 * Wallet Core — Ready (Argent v0.4.0) account adapter.
 *
 * Ready is Argent rebranded. This class hash is declared on Sepolia (`starknet_getClass`
 * returns the `argent::account` ABI) and is the `ready`/`argent` v0.4.0 class hash per
 * Starknet Foundry's sncast account table. It is NOT Argent v0.5.0.
 *
 * This is the account-contract implementation the self-custodial wallet deploys. The wallet
 * core owns the key lifecycle; this adapter only knows how to derive, probe, and deploy the
 * Ready account contract for that key.
 */
export const READY_SEPOLIA_CLASS_HASH =
  process.env.NEXT_PUBLIC_READY_CLASSHASH ||
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

/** Blocks to wait after deployment before STRK20 registration/proving is allowed. */
export const READY_DEPLOY_FINALITY_BLOCKS = 10;

/** How often to poll the chain for finality (ms). */
export const READY_FINALITY_POLL_MS = 10_000;

/** Ceiling on the finality wait (ms). Fails closed to "not finalized" rather than hanging. */
export const READY_FINALITY_TIMEOUT_MS = 20 * 60_000;

export interface ReadyAccountNetworkConfig {
  /** Deployed class hash for the account contract on this network. */
  classHash: string;
  /** False when the account contract is not verified on this network (never use it). */
  supported: boolean;
}

/**
 * Per-network account configuration. The wallet core MUST resolve the class hash from this
 * table — never from a network-agnostic default. Mainnet is NOT verified yet, so it is
 * explicitly `supported: false` and the wallet refuses to derive/deploy there rather than
 * pretending Ready works on Mainnet with the Sepolia class hash.
 */
export const READY_ACCOUNT_CONFIG: Record<WalletNetworkId, ReadyAccountNetworkConfig> = {
  sepolia: { classHash: READY_SEPOLIA_CLASS_HASH, supported: true },
  mainnet: { classHash: "", supported: false },
};

/** True when the Ready account contract is available on the given network. */
export function isReadyAccountSupported(network: WalletNetworkId): boolean {
  return READY_ACCOUNT_CONFIG[network]?.supported === true;
}

function buildReadyConstructorRawArgs(publicKey: string) {
  const signerEnum = new CairoCustomEnum({ Starknet: { pubkey: publicKey } });
  const guardian = new CairoOption(CairoOptionVariant.None);
  return { owner: signerEnum, guardian };
}

/**
 * Ready constructor calldata: `{ owner: enum Starknet { pubkey }, guardian: None }`.
 * Replicates the official starknet-privy-demo `buildReadyConstructor` exactly.
 */
export function buildReadyConstructorCalldata(publicKey: string): string[] {
  return CallData.compile(buildReadyConstructorRawArgs(publicKey));
}

/**
 * Derive the counterfactual Ready account address for a public key:
 *   address = calculateContractAddressFromHash(
 *       salt = publicKey, classHash, constructorCalldata, deployerAddress = 0)
 *
 * This derived address is the real on-chain account. It is deterministic for a given key and
 * identical regardless of which wallet/dapp derives it.
 *
 * The wallet CORE must pass the class hash resolved from `READY_ACCOUNT_CONFIG[network]` —
 * never a network-agnostic default. The single-argument form is retained ONLY for the legacy
 * Sepolia-only Privy lane; it must not be used for Mainnet derivation.
 */
export function computeReadyAccountAddress(
  publicKey: string,
  classHash: string = READY_SEPOLIA_CLASS_HASH,
): string {
  const constructorCalldata = buildReadyConstructorCalldata(publicKey);
  return hash.calculateContractAddressFromHash(publicKey, classHash, constructorCalldata, 0);
}

const NOT_DEPLOYED_ERROR = /not found|not deployed|undeployed|no contract|has no contract/i;

/**
 * Probe on-chain deployment state, distinguishing:
 *  - "deployed":     the address hosts `expectedClassHash` (verified).
 *  - "not_deployed": the RPC definitively reports no contract at the address.
 *  - "unknown":      RPC failure, zero/absent class hash, or the address hosts a DIFFERENT
 *                    class than expected.
 *
 * An RPC failure NEVER maps to "not_deployed" — a deployment must never be authorized on a
 * failed read. When `expectedClassHash` is omitted (legacy callers), any non-zero class hash is
 * treated as deployed for backward compatibility; wallet-core callers always pass it.
 */
export async function probeAccountDeployment(
  provider: Pick<RpcProvider, "getClassHashAt">,
  address: string,
  expectedClassHash?: string,
): Promise<AccountDeploymentProbe> {
  let classHash: unknown;
  try {
    classHash = await provider.getClassHashAt(address);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (NOT_DEPLOYED_ERROR.test(message)) return "not_deployed";
    return "unknown";
  }
  if (classHash === undefined || classHash === null) return "not_deployed";
  const atAddress = BigInt(String(classHash));
  if (atAddress === 0n) return "not_deployed";
  if (expectedClassHash !== undefined && expectedClassHash !== null && expectedClassHash !== "") {
    if (atAddress !== BigInt(expectedClassHash)) return "unknown";
  }
  return "deployed";
}

/**
 * True ONLY when the account is verifiably deployed (expected class hash present on-chain).
 * RPC failures and class-hash mismatches return false and must never authorize a deployment.
 */
export async function isAccountDeployed(
  provider: Pick<RpcProvider, "getClassHashAt">,
  address: string,
  expectedClassHash?: string,
): Promise<boolean> {
  return (await probeAccountDeployment(provider, address, expectedClassHash)) === "deployed";
}

/**
 * Deploy the counterfactual Ready account with a real DEPLOY_ACCOUNT transaction signed by
 * `account` (the wallet core's LOCAL signer). Uses the same salt (publicKey), class hash and
 * constructor calldata as the address derivation so the on-chain address matches
 * `computeReadyAccountAddress` exactly. The account must already be funded (the
 * DEPLOY_ACCOUNT fee is paid by the new account).
 *
 * The wallet CORE passes an explicit class hash from `READY_ACCOUNT_CONFIG[network]`. The
 * default is retained ONLY for the legacy Sepolia-only Privy lane.
 */
export async function deployReadyAccount(
  account: Account,
  publicKey: string,
  classHash: string = READY_SEPOLIA_CLASS_HASH,
): Promise<AccountDeployment> {
  const contractAddress = computeReadyAccountAddress(publicKey, classHash);
  const result = await account.deploySelf({
    classHash,
    constructorCalldata: buildReadyConstructorRawArgs(publicKey),
    addressSalt: publicKey,
    contractAddress,
  });
  return {
    transactionHash: result.transaction_hash,
    contractAddress: result.contract_address,
  };
}

/**
 * Wait until `deployedAtBlock` is `blocks` behind the chain tip (default 10), so the account
 * is finalized enough for the STRK20 prover. Resolves with the latest block number, or throws
 * a descriptive error on timeout.
 */
export async function waitForDeploymentFinality(
  provider: Pick<RpcProvider, "getBlockNumber">,
  deployedAtBlock: number,
  blocks: number = READY_DEPLOY_FINALITY_BLOCKS,
  opts?: { pollMs?: number; timeoutMs?: number },
): Promise<number> {
  const pollMs = opts?.pollMs ?? READY_FINALITY_POLL_MS;
  const timeoutMs = opts?.timeoutMs ?? READY_FINALITY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const latest = await provider.getBlockNumber();
    if (latest - deployedAtBlock >= blocks) return latest;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `Account deployment has not reached ${blocks}-block finality yet. Please retry shortly.`,
  );
}

/**
 * Ready account adapter bound to a public key and an explicit class hash (resolved from
 * `READY_ACCOUNT_CONFIG[network]` by the wallet core). Implements the `AccountAdapter` seam so
 * the wallet core can deploy and probe accounts without knowing Ready specifics.
 */
export class ReadyAccountAdapter implements AccountAdapter {
  readonly type = "ready-v0.4.0";
  readonly address: string;
  readonly publicKey: string;
  private readonly classHash: string;

  constructor(publicKey: string, classHash: string) {
    this.publicKey = publicKey;
    this.classHash = classHash;
    this.address = computeReadyAccountAddress(publicKey, classHash);
  }

  probeDeployment(provider: Pick<RpcProvider, "getClassHashAt">): Promise<AccountDeploymentProbe> {
    return probeAccountDeployment(provider, this.address, this.classHash);
  }

  isDeployed(provider: Pick<RpcProvider, "getClassHashAt">): Promise<boolean> {
    return this.probeDeployment(provider).then((probe) => probe === "deployed");
  }

  deploy(account: Account): Promise<AccountDeployment> {
    return deployReadyAccount(account, this.publicKey, this.classHash);
  }

  waitForFinality(
    provider: Pick<RpcProvider, "getBlockNumber">,
    deployedAtBlock: number,
    blocks?: number,
  ): Promise<number> {
    return waitForDeploymentFinality(provider, deployedAtBlock, blocks);
  }
}