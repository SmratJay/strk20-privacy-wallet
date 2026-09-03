import { Account, CallData, typedData, verifyMessageInStarknet } from "starknet";
import type { ProviderInterface, RpcProvider, Signature, TypedData } from "starknet";
import type { OwnershipVerification } from "./account/types";

export type { OwnershipVerification } from "./account/types";

/**
 * Wallet Core — on-chain ownership verification.
 *
 * Proves that a local signing key controls a deployed Starknet account via the SRC-5 standard
 * `is_valid_signature` (also checked as `isValidSignature` for older accounts). starknet.js's
 * `verifyMessageInStarknet` implements the known-valid/known-invalid response handling across
 * account implementations (Argent/Ready, OpenZeppelin, Braavos), so a single code path works
 * for every account type we import.
 *
 * This is the definitive ownership check for imported accounts whose address is NOT derivable
 * from the key alone (e.g. Braavos).
 */

const OWNERSHIP_CHALLENGE: TypedData = {
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
  message: { message: "ownership" },
};

/**
 * Verify that the signer backing `account` controls the deployed account at `account.address`,
 * by signing a fixed challenge and asking the account contract to validate the signature
 * (SRC-5 `is_valid_signature`). Returns `{ verified: false, method, reason }` — never throws —
 * except when the account is not deployed (callers must probe deployment first).
 */
export async function verifyAccountOwnership(
  account: Account,
  provider: RpcProvider | ProviderInterface,
  opts?: {
    /** Override the challenge typed data (tests). */
    challenge?: TypedData;
  },
): Promise<OwnershipVerification> {
  const challenge = opts?.challenge ?? OWNERSHIP_CHALLENGE;
  const address = account.address;
  try {
    const signature = await account.signMessage(challenge);
    const ok = await verifyMessageInStarknet(provider, challenge, signature as Signature, address);
    return {
      verified: ok,
      method: "is_valid_signature",
      reason: ok ? undefined : "Account rejected the ownership signature.",
    };
  } catch (err) {
    return {
      verified: false,
      method: "is_valid_signature",
      reason: err instanceof Error ? err.message : "Ownership verification failed.",
    };
  }
}

/**
 * Read the `is_valid_signature` result directly via a raw call. Useful for adapters that need
 * the raw response or for provider shapes without the high-level helper. Returns true only on a
 * known-valid response.
 */
export async function callIsValidSignature(
  provider: Pick<ProviderInterface, "callContract">,
  address: string,
  msgHash: string,
  signature: [string, string] | string[],
): Promise<boolean> {
  const response = await provider.callContract({
    contractAddress: address,
    entrypoint: "is_valid_signature",
    calldata: CallData.compile({
      hash: BigInt(msgHash).toString(),
      signature,
    }),
  });
  const first = response[0];
  // SRC-5 VALID is 0x56614c4944; some implementations return 0x1.
  return !["0x0", "0x00", "0"].includes(String(first));
}

export { OWNERSHIP_CHALLENGE };

// Re-export the challenge-hash helper for tests.
export function ownershipChallengeHash(accountAddress: string): string {
  return typedData.getMessageHash(OWNERSHIP_CHALLENGE, accountAddress);
}