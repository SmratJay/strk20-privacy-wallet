import { CallData, CairoCustomEnum, CairoOption, CairoOptionVariant, hash } from "starknet";

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

/**
 * Ready constructor calldata: `{ owner: enum Starknet { pubkey }, guardian: None }`.
 * Replicates the official starknet-privy-demo `buildReadyConstructor` exactly.
 */
export function buildReadyConstructorCalldata(publicKey: string): string[] {
  const signerEnum = new CairoCustomEnum({ Starknet: { pubkey: publicKey } });
  const guardian = new CairoOption(CairoOptionVariant.None);
  return CallData.compile({ owner: signerEnum, guardian });
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
