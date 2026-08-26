import type { AccountInterface, ProviderInterface } from "starknet";

/**
 * STRK fee token address — identical across mainnet, sepolia and devnet (the STRK20 pool
 * charges its protocol fee in STRK). Same constant the starkware demo pins.
 */
export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Default STRK allowance granted to the privacy pool (10 STRK = ~5 pool operations at 2 STRK). */
export const DEFAULT_STRK_ALLOWANCE_TARGET = 10n * 10n ** 18n;

export const POOL_FEE_ENTRYPOINT = "get_fee_amount";
export const ALLOWANCE_ENTRYPOINT = "allowance";
export const APPROVE_ENTRYPOINT = "approve";

export type ApprovalStatus = "idle" | "checking" | "approving" | "confirmed" | "verified";

export interface EnsureAllowanceOptions {
  /** Allowance to grant if currently below `requiredAmount`. Defaults to 10 STRK. */
  target?: bigint;
  onStatus?: (status: ApprovalStatus) => void;
}

export interface AllowanceResult {
  /** True when an approve transaction was submitted and confirmed this call. */
  approved: boolean;
  /** The on-chain allowance after the check. */
  allowance: bigint;
}

function accountProvider(account: AccountInterface): ProviderInterface {
  const provider = (account as unknown as { provider?: ProviderInterface }).provider;
  if (!provider) {
    throw new Error("Account has no RPC provider; cannot check STRK allowance.");
  }
  return provider;
}

/** Read the pool's protocol fee per `apply_actions` call (STRK base units). */
export async function readPoolFee(provider: ProviderInterface, poolAddress: string): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: poolAddress,
    entrypoint: POOL_FEE_ENTRYPOINT,
    calldata: [],
  });
  return BigInt(result[0] ?? "0x0");
}

/** Read the ERC20 allowance owner→spender. Starknet u256 returns [low, high]. */
export async function readAllowance(
  provider: ProviderInterface,
  owner: string,
  tokenAddress: string,
  spender: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: tokenAddress,
    entrypoint: ALLOWANCE_ENTRYPOINT,
    calldata: [owner, spender],
  });
  const low = BigInt(result[0] ?? "0x0");
  const high = BigInt(result[1] ?? "0x0");
  return low + (high << 128n);
}

/**
 * Ensure the Privy account has approved enough STRK for the privacy pool to charge its fee.
 *
 * - Reads the current allowance.
 * - If already `>= requiredAmount` → no transaction (returns `{ approved: false }`).
 * - Otherwise submits an ordinary ERC20 `approve` (never a privacy proof), waits for the receipt,
 *   re-reads the allowance, and throws a precise error if the allowance is still insufficient.
 */
export async function ensurePrivacyPoolAllowance(
  account: AccountInterface,
  tokenAddress: string,
  spender: string,
  requiredAmount: bigint,
  opts: EnsureAllowanceOptions = {},
): Promise<AllowanceResult> {
  const provider = accountProvider(account);

  opts.onStatus?.("checking");
  const allowance = await readAllowance(provider, account.address, tokenAddress, spender);
  if (allowance >= requiredAmount) {
    return { approved: false, allowance };
  }

  const target = opts.target ?? DEFAULT_STRK_ALLOWANCE_TARGET;
  if (target < requiredAmount) {
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }

  opts.onStatus?.("approving");
  const response = await account.execute({
    contractAddress: tokenAddress,
    entrypoint: APPROVE_ENTRYPOINT,
    calldata: [spender, target, 0n],
  });

  opts.onStatus?.("confirmed");
  await provider.waitForTransaction(response.transaction_hash, { retryInterval: 4000 });

  opts.onStatus?.("verified");
  const postAllowance = await readAllowance(provider, account.address, tokenAddress, spender);
  if (postAllowance < requiredAmount) {
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }
  return { approved: true, allowance: postAllowance };
}