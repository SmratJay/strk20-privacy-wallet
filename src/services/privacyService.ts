import { RpcProvider, num, uint256, hash } from 'starknet';
import { STRK20_POOL_ADDRESS, ALCHEMY_RPC_URL, MAINNET_TOKENS, TokenInfo } from '@/config/tokens';

export const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'balance', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
    ],
    outputs: [{ name: 'remaining', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [{ name: 'success', type: 'core::bool' }],
    state_mutability: 'external',
  },
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [{ name: 'success', type: 'core::bool' }],
    state_mutability: 'external',
  },
];

export interface ShieldedBalance {
  token: TokenInfo;
  publicBalance: bigint;
  shieldedBalance: bigint;
  pendingNotesCount: number;
  /** true only for wallets that natively expose the STRK20 Privacy Wallet API (e.g. Ready Wallet) */
  privacyApiSupported: boolean;
}

export interface PrivacyTransaction {
  id: string;
  type: 'SHIELD' | 'PRIVATE_TRANSFER' | 'UNSHIELD' | 'SWAP';
  txHash?: string;
  timestamp: number;
  tokenSymbol: string;
  amount: string;
  recipient?: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  isPrivate: boolean;
  privacyDetails: string;
}

// Fallback public RPC endpoints in priority order
const RPC_FALLBACK_CHAIN = [
  ALCHEMY_RPC_URL,
  'https://free-rpc.nethermind.io/mainnet-juno',
  'https://starknet-mainnet.public.blastapi.io',
];

export class PrivacyService {
  private rpcProvider: RpcProvider;

  constructor() {
    this.rpcProvider = new RpcProvider({ nodeUrl: ALCHEMY_RPC_URL });
  }

  /**
   * Robust parsing of Starknet u256 / felt return shapes from contract calls
   */
  parseU256Result(res: any): bigint {
    if (typeof res === 'bigint') {
      return res;
    }
    if (typeof res === 'number') {
      return BigInt(res);
    }
    if (typeof res === 'string') {
      try { return BigInt(res); } catch { return 0n; }
    }
    if (res && typeof res.balance !== 'undefined') {
      return this.parseU256Result(res.balance);
    }
    if (res && typeof res.low !== 'undefined' && typeof res.high !== 'undefined') {
      return uint256.uint256ToBN(res);
    }
    if (Array.isArray(res) && res.length >= 2) {
      return uint256.uint256ToBN({ low: res[0], high: res[1] });
    }
    return 0n;
  }

  /**
   * Fetch ERC-20 balance using raw callContract (bypasses ABI parsing quirks).
   * Tries each RPC in fallback chain until one succeeds.
   */
  private async fetchERC20Balance(tokenAddress: string, accountAddress: string): Promise<bigint> {
    // balanceOf selector
    const selector = hash.getSelectorFromName('balanceOf');
    const calldata = [num.toHex(accountAddress)];

    for (const nodeUrl of RPC_FALLBACK_CHAIN) {
      try {
        const provider = new RpcProvider({ nodeUrl });
        const result = await provider.callContract({
          contractAddress: tokenAddress,
          entrypoint: 'balanceOf',
          calldata,
        });
        // result is string[], Cairo 2 returns [low, high] for u256
        if (Array.isArray(result) && result.length >= 2) {
          return uint256.uint256ToBN({ low: result[0], high: result[1] });
        }
        if (Array.isArray(result) && result.length === 1) {
          return BigInt(result[0]);
        }
        return 0n;
      } catch (err: any) {
        console.warn(`RPC ${nodeUrl} failed for balanceOf ${tokenAddress}:`, err?.message);
      }
    }
    return 0n;
  }

  /**
   * Fetches both public and shielded STRK20 balances for a given account.
   * Public balances are fetched via direct callContract (no ABI parsing).
   * Shielded balances are fetched only from wallets that expose the STRK20 Privacy API.
   */
  async fetchBalances(accountAddress: string, walletAccount?: any): Promise<ShieldedBalance[]> {
    const results: ShieldedBalance[] = [];
    // Detect privacy API support ONCE — only Ready Wallet exposes strk20Balances
    const privacyApiSupported =
      walletAccount != null && typeof walletAccount.strk20Balances === 'function';

    for (const token of MAINNET_TOKENS) {
      let publicBalance = 0n;
      let shieldedBalance = 0n;

      // 1. Fetch public ERC-20 balance via robust direct callContract (no ABI parse layer)
      try {
        publicBalance = await this.fetchERC20Balance(token.address, accountAddress);
      } catch (err) {
        console.warn(`Could not fetch public balance for ${token.symbol}:`, err);
      }

      // 2. Query shielded balance only if wallet exposes STRK20 Privacy API
      if (privacyApiSupported) {
        try {
          const shieldedRes = await walletAccount.strk20Balances([token.address]);
          if (shieldedRes && shieldedRes[token.address]) {
            shieldedBalance = BigInt(shieldedRes[token.address]);
          }
        } catch (err) {
          console.warn(`Shielded balance query for ${token.symbol}:`, err);
        }
      }

      results.push({
        token,
        publicBalance,
        shieldedBalance,
        pendingNotesCount: 0,
        privacyApiSupported,
      });
    }

    return results;
  }

  /**
   * Safe transaction wait with ceiling timeout per Wallet API gotchas
   */
  async waitForTxWithTimeout(txHash: string, timeoutMs = 15000): Promise<boolean> {
    try {
      const waitPromise = this.rpcProvider.waitForTransaction(txHash);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), timeoutMs));
      const res = await Promise.race([waitPromise, timeoutPromise]);
      return res !== 'TIMEOUT';
    } catch {
      return false;
    }
  }

  /**
   * Step 1 + 2: Shield tokens into the STRK20 Privacy Pool
   * 1. ERC20 Approve pool
   * 2. Pool deposit invocation
   */
  async executeShield(
    walletAccount: any,
    token: TokenInfo,
    amountBigInt: bigint,
    onStepChange?: (step: 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED') => void
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    const u256Amount = uint256.bnToUint256(amountBigInt);

    // If wallet natively supports STRK20 shield action
    if (typeof walletAccount.strk20Shield === 'function') {
      onStepChange?.('PROVING');
      const res = await walletAccount.strk20Shield({
        token: token.address,
        amount: amountBigInt.toString(),
      });
      return { txHash: res.transaction_hash || res.hash || '0x' };
    }

    // Standard two-step Starknet call: Approve ERC20 -> Deposit to Pool
    onStepChange?.('APPROVING');
    const approveCall = {
      contractAddress: token.address,
      entrypoint: 'approve',
      calldata: [STRK20_POOL_ADDRESS, u256Amount.low, u256Amount.high],
    };

    onStepChange?.('SHIELDING');
    const depositCall = {
      contractAddress: STRK20_POOL_ADDRESS,
      entrypoint: 'deposit',
      calldata: [token.address, u256Amount.low, u256Amount.high],
    };

    // Execute multi-call via connected account
    const tx = await walletAccount.execute([approveCall, depositCall]);
    onStepChange?.('SUBMITTED');

    return { txHash: tx.transaction_hash };
  }

  /**
   * Execute private note transfer inside STRK20 pool
   */
  async executePrivateTransfer(
    walletAccount: any,
    token: TokenInfo,
    recipientViewingKeyOrAddress: string,
    amountBigInt: bigint,
    onStepChange?: (step: 'PREPARING' | 'PROVING' | 'SUBMITTING') => void
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    onStepChange?.('PREPARING');

    if (typeof walletAccount.strk20Transfer === 'function') {
      onStepChange?.('PROVING');
      const res = await walletAccount.strk20Transfer({
        token: token.address,
        recipient: recipientViewingKeyOrAddress,
        amount: amountBigInt.toString(),
      });
      onStepChange?.('SUBMITTING');
      return { txHash: res.transaction_hash || res.hash || '0x' };
    }

    // Fallback invocation through pool contract
    const u256Amount = uint256.bnToUint256(amountBigInt);
    const transferCall = {
      contractAddress: STRK20_POOL_ADDRESS,
      entrypoint: 'transfer',
      calldata: [token.address, recipientViewingKeyOrAddress, u256Amount.low, u256Amount.high],
    };

    const tx = await walletAccount.execute([transferCall]);
    return { txHash: tx.transaction_hash };
  }

  /**
   * Execute unshield (withdraw private note back to public address)
   */
  async executeUnshield(
    walletAccount: any,
    token: TokenInfo,
    destinationAddress: string,
    amountBigInt: bigint,
    onStepChange?: (step: 'PROVING' | 'SUBMITTING') => void
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    onStepChange?.('PROVING');

    if (typeof walletAccount.strk20Unshield === 'function') {
      const res = await walletAccount.strk20Unshield({
        token: token.address,
        recipient: destinationAddress,
        amount: amountBigInt.toString(),
      });
      onStepChange?.('SUBMITTING');
      return { txHash: res.transaction_hash || res.hash || '0x' };
    }

    const u256Amount = uint256.bnToUint256(amountBigInt);
    const withdrawCall = {
      contractAddress: STRK20_POOL_ADDRESS,
      entrypoint: 'withdraw',
      calldata: [token.address, destinationAddress, u256Amount.low, u256Amount.high],
    };

    const tx = await walletAccount.execute([withdrawCall]);
    return { txHash: tx.transaction_hash };
  }
}

export const privacyService = new PrivacyService();
