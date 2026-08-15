import { Contract, RpcProvider, num, uint256 } from 'starknet';
import { STRK20_POOL_ADDRESS, ALCHEMY_RPC_URL, MAINNET_TOKENS, TokenInfo, DEFAULT_POOL_FEE_STRK } from '@/config/tokens';

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'balance', type: 'core::integer::u256' }],
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
];

export interface ShieldedBalance {
  token: TokenInfo;
  publicBalance: bigint;
  shieldedBalance: bigint;
  pendingNotesCount: number;
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

export class PrivacyService {
  private rpcProvider: RpcProvider;

  constructor() {
    this.rpcProvider = new RpcProvider({ nodeUrl: ALCHEMY_RPC_URL });
  }

  /**
   * Fetches both public and shielded STRK20 balances for a given account
   */
  async fetchBalances(accountAddress: string, walletAccount?: any): Promise<ShieldedBalance[]> {
    const results: ShieldedBalance[] = [];

    for (const token of MAINNET_TOKENS) {
      let publicBalance = 0n;
      let shieldedBalance = 0n;

      // 1. Fetch public ERC20 balance
      try {
        const contract = new Contract({
          abi: ERC20_ABI,
          address: token.address,
          providerOrAccount: this.rpcProvider,
        });
        const res: any = await contract.call('balanceOf', [accountAddress]);
        if (res && res.balance) {
          publicBalance = uint256.uint256ToBN(res.balance);
        } else if (typeof res === 'bigint') {
          publicBalance = res;
        }
      } catch (err) {
        console.warn(`Could not fetch public balance for ${token.symbol}:`, err);
      }

      // 2. Fetch shielded balance via WalletAccountV6 if available
      if (walletAccount && typeof walletAccount.strk20Balances === 'function') {
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
      });
    }

    return results;
  }

  /**
   * Step 1 + 2: Shield tokens into the STRK20 Privacy Pool
   * 1. ERC20 Approve pool
   * 2. Pool deposit / shield invocation
   */
  async executeShield(
    walletAccount: any,
    token: TokenInfo,
    amountBigInt: bigint,
    onStepChange?: (step: 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED') => void
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    const u256Amount = uint256.bnToUint256(amountBigInt);

    // If wallet supports native STRK20 shield action
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
