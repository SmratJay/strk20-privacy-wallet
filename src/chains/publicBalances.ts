/**
 * Neutral chain/data boundary — public on-chain ERC-20 balance reads.
 *
 * Generic RPC/chain data only. It does NOT perform any STRK20 privacy-protocol orchestration
 * (that lives in `src/privacy/strk20` via the official vendored SDK) and it never fabricates a
 * private balance. `ok === false` means EVERY RPC was unreachable — the caller must NOT treat
 * the returned 0 as a real balance.
 */

import { RpcProvider, num, uint256, hash } from "starknet";
import type { TokenInfo, NetworkConfig } from "@/config/networks";

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ name: "balance", type: "core::integer::u256" }],
    state_mutability: "view",
  },
];

export interface TokenBalanceRow {
  token: TokenInfo;
  publicBalance: bigint;
  /** False when the RPC could not be reached for this token — the UI must show "—", never a fabricated 0. */
  publicBalanceAvailable: boolean;
}

/** Robust parsing of Starknet u256 / felt return shapes from contract calls. */
export function parseU256Result(res: unknown): bigint {
  if (typeof res === "bigint") return res;
  if (typeof res === "number") return BigInt(res);
  if (typeof res === "string") {
    try {
      return BigInt(res);
    } catch {
      return 0n;
    }
  }
  const r = res as { balance?: unknown; low?: unknown; high?: unknown } | unknown[] | null;
  if (r && typeof r === "object") {
    if (Array.isArray(r)) {
      if (r.length >= 2) return uint256.uint256ToBN({ low: r[0], high: r[1] } as never);
      if (r.length === 1) return BigInt(String(r[0] ?? "0x0"));
      return 0n;
    }
    const obj = r as { balance?: unknown; low?: unknown; high?: unknown };
    if (obj.balance !== undefined) return parseU256Result(obj.balance);
    if (obj.low !== undefined && obj.high !== undefined) {
      return uint256.uint256ToBN({ low: obj.low, high: obj.high } as never);
    }
  }
  return 0n;
}

async function fetchERC20Balance(
  tokenAddress: string,
  accountAddress: string,
  rpcUrls: string[],
): Promise<{ balance: bigint; ok: boolean }> {
  const selector = hash.getSelectorFromName("balanceOf");
  const calldata = [num.toHex(accountAddress)];

  for (const nodeUrl of rpcUrls) {
    try {
      const provider = new RpcProvider({ nodeUrl });
      const result = await provider.callContract({
        contractAddress: tokenAddress,
        entrypoint: "balanceOf",
        calldata,
      });
      const balance = parseU256Result(result);
      return { balance, ok: true };
    } catch {
      // Try the next RPC; only if ALL fail do we report ok=false.
    }
  }
  return { balance: 0n, ok: false };
}

/**
 * Fetch PUBLIC on-chain balances for the active network's tokens. Private (shielded) balances
 * are NOT read here — they come from the STRK20 discovery layer (WalletPrivacySession).
 */
export async function fetchPublicBalances(
  accountAddress: string,
  network: NetworkConfig,
): Promise<TokenBalanceRow[]> {
  const results: TokenBalanceRow[] = [];
  for (const token of network.tokens) {
    const pub = await fetchERC20Balance(token.address, accountAddress, network.rpcUrls);
    results.push({
      token,
      publicBalance: pub.balance,
      publicBalanceAvailable: pub.ok,
    });
  }
  return results;
}

export const chainBalances = {
  fetchBalances: fetchPublicBalances,
};