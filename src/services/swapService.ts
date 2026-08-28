/**
 * @file src/services/swapService.ts
 * @description Real AVNU swap flows (public + STRK20 private) using the current
 * `@avnu/avnu-sdk` (> 4.2). Reuses the connected wallet for execution/proving and the
 * STRK20 Wallet API lane for private balances. The AVNU paymaster key stays server-side
 * (see /api/avnu/paymaster); the browser never holds it.
 */
import {
  getQuotes,
  quoteToCalls,
  executePrivateSwap,
  buildStrk20Actions,
  type Quote,
  type PrivateSwapProver,
  BASE_URL,
  SEPOLIA_BASE_URL,
} from '@avnu/avnu-sdk';
import type { NetworkId } from '@/config/networks';
import type { TokenInfo } from '@/config/tokens';
import { parseTokenAmount } from '@/utils/formatters';
import { resolveWalletApiProvider } from '@/services/strk20WalletApiService';

export interface SwapQuoteResult {
  quote: Quote;
  /** Human-readable estimated buy amount (token units). */
  buyAmount: string;
  /** Human-readable estimated gas fee in STRK. */
  gasFeeStrk: string;
  routes: string[];
  sellAmount: bigint;
}

export function avnuBaseUrlFor(networkId: NetworkId): string {
  return networkId === 'sepolia' ? SEPOLIA_BASE_URL : BASE_URL;
}

export function paymasterProxyUrlFor(networkId: NetworkId): string {
  return `/api/avnu/paymaster?network=${networkId}`;
}

export function chainIdHexFor(networkId: NetworkId): string {
  return networkId === 'sepolia' ? '0x534e5f5345504f4c4941' : '0x534e5f4d41494e';
}

const SIGNED_CHAIN_ID: Record<string, string> = {
  '0x534e5f5345504f4c4941': 'sepolia', // SN_SEPOLIA
  '0x534e5f4d41494e': 'mainnet', // SN_MAIN
};

export function networkIdFromChainId(chainId: string | bigint | null | undefined): NetworkId {
  if (chainId === undefined || chainId === null) return 'mainnet';
  const raw = String(chainId);
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw : '0x' + raw;
  return (SIGNED_CHAIN_ID[hex.toLowerCase()] ?? 'mainnet') as NetworkId;
}

/**
 * Fetch the best AVNU quote for a sell/buy pair. `takerAddress` is the address the
 * quote is computed for — for a public swap the user's address; for a private swap the
 * user's address as well (AVNU routes privately via `quoteToCalls({ private: true })`).
 * Returns null when AVNU has no route/liquidity for the pair.
 */
export async function getSwapQuote(
  networkId: NetworkId,
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  amountStr: string,
  takerAddress: string,
): Promise<SwapQuoteResult | null> {
  if (!amountStr || parseFloat(amountStr) <= 0) return null;
  const sellAmount = parseTokenAmount(amountStr, sellToken.decimals);
  const quotes = await getQuotes(
    {
      sellTokenAddress: sellToken.address,
      buyTokenAddress: buyToken.address,
      sellAmount,
      takerAddress,
      size: 1,
    },
    { baseUrl: avnuBaseUrlFor(networkId) },
  );
  const quote = quotes?.[0];
  if (!quote) return null;
  const buyAmountNum = Number(quote.buyAmount) / 10 ** buyToken.decimals;
  return {
    quote,
    buyAmount: buyAmountNum.toFixed(buyToken.decimals >= 8 ? 6 : 4),
    gasFeeStrk: (Number(quote.gasFees ?? 0n) / 1e18).toFixed(4),
    routes: quote.routes.map((r) => r.name || 'DEX'),
    sellAmount,
  };
}

/**
 * PUBLIC swap: `wallet balance → AVNU → wallet balance`.
 * Builds the swap calls for the connected account and executes them with the wallet.
 * Returns the on-chain transaction hash.
 */
export async function executePublicSwap(
  walletAccount: any,
  networkId: NetworkId,
  quote: Quote,
  slippage: number,
): Promise<{ transactionHash: string }> {
  if (!walletAccount || typeof walletAccount.execute !== 'function') {
    throw new Error('Connected wallet does not support transaction execution.');
  }
  const takerAddress = walletAccount.address ?? walletAccount.selectedAddress;
  if (!takerAddress) throw new Error('Could not resolve wallet address for the swap.');

  const { calls } = await quoteToCalls(
    { quoteId: quote.quoteId, slippage, takerAddress, executeApprove: true },
    { baseUrl: avnuBaseUrlFor(networkId) },
  );
  if (!calls || calls.length === 0) {
    throw new Error('Could not build swap calls from AVNU router.');
  }
  const res = await walletAccount.execute(calls);
  const transactionHash = res?.transaction_hash ?? res?.transactionHash ?? res?.hash;
  if (!transactionHash) throw new Error('Swap submitted but no transaction hash returned.');
  return { transactionHash };
}

/**
 * STRK20-capable wallet prover for AVNU private swaps.
 *
 * Proves the AVNU private-swap plan with the connected wallet: it builds the four STRK20
 * actions (withdraw sell → executor, withdraw pool fee → paymaster, open buy note,
 * invoke executor) and asks the wallet to materialize the SNIP-36 proof
 * (`wallet_strk20PrepareInvoke`). The dapp never touches keys or notes.
 */
function createWalletPrivateProver(wallet: any): PrivateSwapProver {
  const account = wallet?.walletAccount;
  const provider = resolveWalletApiProvider(wallet);
  return {
    buildAndProve: async (plan) => {
      const actions = buildStrk20Actions(plan);
      let call: any;
      let proof: any;
      if (account && typeof account.strk20PrepareInvoke === 'function') {
        const res = await account.strk20PrepareInvoke(actions);
        call = res.call;
        proof = res.proof;
      } else if (provider) {
        const res: any = await provider.request({
          type: 'wallet_strk20PrepareInvoke',
          params: { actions },
        });
        call = res?.call;
        proof = res?.proof;
      } else {
        throw new Error('A STRK20-capable wallet (Ready) is required for private swaps.');
      }
      if (!call || !proof) {
        throw new Error('The wallet did not return a proof for the private swap.');
      }
      return {
        call: {
          contractAddress: call.contract_address,
          entrypoint: call.entry_point,
          calldata: call.calldata ?? [],
        },
        proof: { data: proof.data, proofFacts: proof.proof_facts },
      };
    },
  };
}

export interface ExecutePrivateSwapParams {
  wallet: any;
  networkId: NetworkId;
  quote: Quote;
  slippage: number;
  /** The user's Starknet address (open-note recipient + quote taker). */
  takerAddress: string;
  /** Privacy pool contract address for the active network. */
  poolAddress: string;
  /** Token the user pays the AVNU pool fee in (defaults to the sell token). */
  poolFeeToken?: string;
}

/**
 * PRIVATE STRK20 swap: `STRK20 private balance → AVNU/private executor → STRK20 private balance`.
 *
 * Orchestrated by AVNU's `executePrivateSwap`:
 *   1. paymaster returns the pool fee (proxied server-side, key never in browser)
 *   2. `quoteToCalls({ private: true })` returns the executor calls + address
 *   3. the wallet proves the private transaction (withdraw sell → executor, withdraw
 *      fee, open buy note, invoke executor) via `wallet_strk20PrepareInvoke`
 *   4. the paymaster relays the proof on-chain and returns the transaction hash
 */
export async function executePrivateSwapFlow(
  params: ExecutePrivateSwapParams,
): Promise<{ transactionHash: string }> {
  const { wallet, networkId, quote, slippage, takerAddress, poolAddress, poolFeeToken } = params;
  const feeMode = { poolFeeToken: poolFeeToken ?? quote.sellTokenAddress, tip: 'normal' as const };
  const res = await executePrivateSwap(
    {
      quote,
      slippage,
      takerAddress,
      poolAddress,
      feeMode,
      prover: createWalletPrivateProver(wallet),
      chainId: chainIdHexFor(networkId),
    },
    {
      baseUrl: avnuBaseUrlFor(networkId),
      paymasterBaseUrl: paymasterProxyUrlFor(networkId),
    },
  );
  const transactionHash = res?.transactionHash;
  if (!transactionHash) throw new Error('Private swap submitted but no transaction hash returned.');
  return { transactionHash };
}