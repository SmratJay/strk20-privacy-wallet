import {
  CallData,
  CairoCustomEnum,
  CairoOption,
  CairoOptionVariant,
  hash,
} from "starknet";
import type { Account, RpcProvider } from "starknet";

/**
 * Ready (Argent rebranded) account on Starknet Sepolia, v0.4.0.
 *
 * Verified: this class hash is declared on Sepolia (`starknet_getClass` returns the
 * `argent::account` ABI) and is the `ready`/`argent` v0.4.0 class hash per Starknet
 * Foundry's sncast account table. It is NOT Argent v0.5.0.
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
 * Derive the counterfactual Ready account address for a Privy Starknet public key:
 *   address = calculateContractAddressFromHash(
 *       salt = publicKey, classHash, constructorCalldata, deployerAddress = 0)
 *
 * NOTE: this derived address is the real on-chain account. It is NOT equal to
 * Privy's `wallet.address` (verified live: they differ). Use this everywhere.
 */
export function computeReadyAccountAddress(
  publicKey: string,
  classHash: string = READY_SEPOLIA_CLASS_HASH,
): string {
  const constructorCalldata = buildReadyConstructorCalldata(publicKey);
  return hash.calculateContractAddressFromHash(publicKey, classHash, constructorCalldata, 0);
}

/**
 * True when `address` has on-chain class hash (i.e. the account contract is deployed).
 * False when the RPC reports the contract as not found / undeployed. Fails closed on
 * any other RPC error (treats it as not deployed so the caller can retry safely).
 */
export async function isAccountDeployed(
  provider: Pick<RpcProvider, "getClassHashAt">,
  address: string,
): Promise<boolean> {
  try {
    const classHash = await provider.getClassHashAt(address);
    if (classHash === undefined || classHash === null) return false;
    return BigInt(classHash) !== 0n;
  } catch {
    return false;
  }
}

export interface ReadyAccountDeployment {
  transactionHash: string;
  contractAddress: string;
}

/**
 * Deploy the counterfactual Ready account with a real DEPLOY_ACCOUNT transaction, signed
 * through the existing Privy signer (`/api/privy/sign` → `StarknetPrivySigner`). Uses the
 * same salt (publicKey), class hash and constructor calldata as the address derivation so
 * the on-chain address matches `computeReadyAccountAddress` exactly.
 *
 * The account must already be funded (the DEPLOY_ACCOUNT fee is paid by the new account).
 */
export async function deployReadyAccount(
  account: Account,
  publicKey: string,
  classHash: string = READY_SEPOLIA_CLASS_HASH,
): Promise<ReadyAccountDeployment> {
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
