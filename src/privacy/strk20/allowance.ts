import type { AccountInterface, ProviderInterface } from "starknet";

/**
 * Wallet Core — STRK20 privacy allowance helpers (neutral; no Privy).
 *
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

export type ApprovalStatus =
  | "idle"
  | "checking"
  | "approving"
  | "submitted"
  | "confirmed"
  | "verified";

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

const U128_MAX = (1n << 128n) - 1n;

function accountProvider(account: AccountInterface): ProviderInterface {
  const provider = (account as unknown as { provider?: ProviderInterface }).provider;
  if (!provider) {
    throw new Error("Account has no RPC provider; cannot check STRK allowance.");
  }
  return provider;
}

/** Sanitized RPC endpoint for diagnostics — never logs query strings, keys, or auth material. */
function safeProviderUrl(provider: ProviderInterface): string {
  try {
    const raw = (provider as unknown as { channel?: { nodeUrl?: unknown }; nodeUrl?: unknown })
      ?.channel?.nodeUrl ?? (provider as unknown as { nodeUrl?: unknown })?.nodeUrl;
    if (typeof raw !== "string" || !raw) return "unknown";
    const u = new URL(raw);
    const segs = u.pathname.split("/").filter(Boolean);
    // Drop the last path segment (commonly an API key / token) and any query/fragment.
    const path = segs.length > 1 ? "/" + segs.slice(0, -1).join("/") : segs.length === 1 ? "" : "";
    return u.origin + path;
  } catch {
    return "unknown";
  }
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

function allowanceParts(allowance: bigint): { low: string; high: string } {
  return {
    low: (allowance & U128_MAX).toString(),
    high: (allowance >> 128n).toString(),
  };
}

/**
 * Ensure the Privy account has approved enough STRK for the privacy pool to charge its fee.
 *
 * - Reads the current allowance.
 * - If already `>= requiredAmount` → no transaction.
 * - Otherwise submits an ordinary ERC20 `approve` (never a privacy proof), waits for the receipt,
 *   verifies `execution_status` is SUCCEEDED, re-reads the allowance, and throws a precise error
 *   if the allowance is still insufficient — so the ~20s privacy proof is NEVER started with a
 *   zero on-chain allowance.
 */
export async function ensurePrivacyPoolAllowance(
  account: AccountInterface,
  tokenAddress: string,
  spender: string,
  requiredAmount: bigint,
  opts: EnsureAllowanceOptions = {},
): Promise<AllowanceResult> {
  const provider = accountProvider(account);
  const rpc = safeProviderUrl(provider);
  // Dynamic target: never approve less than the required allowance (e.g. a 42-STRK shield needs
  // 44 STRK approved, not just the 10-STRK default); still grant at least the default headroom.
  const target =
    opts.target ??
    (requiredAmount > DEFAULT_STRK_ALLOWANCE_TARGET
      ? requiredAmount
      : DEFAULT_STRK_ALLOWANCE_TARGET);

  const log = (msg: string, data?: unknown) => {
    // eslint-disable-next-line no-console
    console.log(`[PrivyAllowance] ${msg}`, data === undefined ? "" : data);
  };
  const logErr = (msg: string, err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      `[PrivyAllowance] ${msg}`,
      err instanceof Error ? { message: err.message, stack: err.stack } : err,
    );
  };

  log("provider", rpc);
  log("owner", account.address);
  log("token", tokenAddress);
  log("spender", spender);
  log("requiredAmount", requiredAmount.toString());
  log("targetAllowance", target.toString());

  opts.onStatus?.("checking");
  const allowance = await readAllowance(provider, account.address, tokenAddress, spender);
  log("initialAllowance", allowance.toString());
  if (allowance >= requiredAmount) {
    return { approved: false, allowance };
  }

  if (target < requiredAmount) {
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }

  opts.onStatus?.("approving");
  // approve(spender, amount: u256) → calldata [spender, low, high].
  const approveCall = {
    contractAddress: tokenAddress,
    entrypoint: APPROVE_ENTRYPOINT,
    calldata: [spender, target, 0n],
  };
  log(
      "approve calldata",
      JSON.stringify(approveCall.calldata.map((v) => (typeof v === "bigint" ? v.toString() : v))),
    );

  let transactionHash: string;
  try {
    log("account.execute start");
    const response = await account.execute(approveCall);
    transactionHash = response.transaction_hash;
    log("account.execute returned transactionHash", transactionHash);
  } catch (err) {
    logErr("account.execute FAILED", err);
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }

  opts.onStatus?.("submitted");
  log("waitForTransaction start");
  let receipt: {
    execution_status?: string;
    finality_status?: string;
    status?: string;
    revert_reason?: unknown;
    transaction_failure_reason?: { revert_reason?: unknown };
  };
  try {
    receipt = (await provider.waitForTransaction(transactionHash, { retryInterval: 4000 })) as unknown as {
      execution_status?: string;
      finality_status?: string;
      status?: string;
      revert_reason?: unknown;
      transaction_failure_reason?: { revert_reason?: unknown };
    };
  } catch (err) {
    logErr("waitForTransaction FAILED", err);
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }
  const executionStatus = receipt?.execution_status ?? receipt?.status;
  const finalityStatus = receipt?.finality_status;
  const revertReason = receipt?.revert_reason ?? receipt?.transaction_failure_reason?.revert_reason;
  log("receipt execution_status", executionStatus);
  log("receipt finality_status", finalityStatus);
  log("receipt revert_reason", revertReason ?? "(none)");
  if (executionStatus === "REVERTED" || executionStatus === "REJECTED") {
    logErr("approve transaction reverted", revertReason ?? "(no revert reason)");
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }
  log("waitForTransaction complete");
  opts.onStatus?.("confirmed");

  // Authoritative on-chain gate: allowance must be >= fee. Re-read (briefly retrying in case the
  // node's "latest" lags the acceptance) before any privacy proof is allowed to start.
  let postAllowance = await readAllowance(provider, account.address, tokenAddress, spender);
  log("postApprovalAllowance", postAllowance.toString());
  log("postApprovalAllowance low", allowanceParts(postAllowance).low);
  log("postApprovalAllowance high", allowanceParts(postAllowance).high);

  for (let attempt = 0; attempt < 3 && postAllowance < requiredAmount; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    postAllowance = await readAllowance(provider, account.address, tokenAddress, spender);
    log("postApprovalAllowance retry", postAllowance.toString());
  }

  if (postAllowance < requiredAmount) {
    logErr(
      "approve did not produce sufficient on-chain allowance",
      { required: requiredAmount.toString(), actual: postAllowance.toString() },
    );
    throw new Error("Could not approve STRK spending for the privacy pool.");
  }

  opts.onStatus?.("verified");
  return { approved: true, allowance: postAllowance };
}