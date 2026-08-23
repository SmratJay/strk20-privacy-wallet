import { RpcProvider, num, uint256, hash } from 'starknet';
import { getActiveRpcUrl, TokenInfo, NetworkConfig, NETWORKS, DEFAULT_NETWORK_ID } from '@/config/tokens';

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
  privacyApiSupported: boolean;
  /** false when the RPC could not be reached for this token — UI must show "—", never a fabricated 0. */
  publicBalanceAvailable: boolean;
  /**
   * true when shieldedBalance came from the privacy wallet (Wallet API) / real STRK20
   * discovery. When false the private balance is UNKNOWN — the UI must never treat 0 as
   * authoritative, and never read a localStorage note store as balance authority.
   */
  shieldedBalanceAvailable?: boolean;
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
  private defaultRpcProvider: RpcProvider;

  constructor() {
    this.defaultRpcProvider = new RpcProvider({ nodeUrl: getActiveRpcUrl(DEFAULT_NETWORK_ID) });
  }

  getRpcProvider(network?: NetworkConfig): RpcProvider {
    if (network && network.rpcUrls && network.rpcUrls.length > 0) {
      return new RpcProvider({ nodeUrl: network.rpcUrls[0] });
    }
    return this.defaultRpcProvider;
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
   * Returns `{ balance, ok }` — `ok=false` means EVERY RPC was unreachable/errored,
   * so the caller must NOT treat the balance as a real 0 (honest display).
   */
  private async fetchERC20Balance(
    tokenAddress: string,
    accountAddress: string,
    rpcUrls: string[]
  ): Promise<{ balance: bigint; ok: boolean }> {
    const selector = hash.getSelectorFromName('balanceOf');
    const calldata = [num.toHex(accountAddress)];

    for (const nodeUrl of rpcUrls) {
      try {
        const provider = new RpcProvider({ nodeUrl });
        const result = await provider.callContract({
          contractAddress: tokenAddress,
          entrypoint: 'balanceOf',
          calldata,
        });
        // Cairo 2 returns [low, high] for u256
        if (Array.isArray(result) && result.length >= 2) {
          return { balance: uint256.uint256ToBN({ low: result[0], high: result[1] }), ok: true };
        }
        if (Array.isArray(result) && result.length === 1) {
          return { balance: BigInt(result[0]), ok: true };
        }
        console.warn(`RPC ${nodeUrl} returned unexpected balanceOf shape for ${tokenAddress}:`, result);
      } catch (err: any) {
        console.warn(`RPC ${nodeUrl} failed for balanceOf ${tokenAddress}:`, err?.message);
      }
    }
    return { balance: 0n, ok: false };
  }

  /**
   * Fetches PUBLIC on-chain balances for the active network's tokens.
   *
   * Private (shielded) balances are NOT authoritative here: the generic STRK20 lane reads
   * them from the privacy wallet via the Wallet API (strk20WalletApiService), and PEL reads
   * them from real STRK20 discovery. This method never treats localStorage note stores as
   * balance authority, and never fabricates a private balance.
   */
  async fetchBalances(
    accountAddress: string,
    _walletAccount?: any,
    network?: NetworkConfig
  ): Promise<ShieldedBalance[]> {
    const activeNetwork = network || NETWORKS.mainnet;
    const tokens = activeNetwork.tokens;
    const rpcUrls = activeNetwork.rpcUrls;
    const results: ShieldedBalance[] = [];

    for (const token of tokens) {
      let publicBalance = 0n;
      let publicBalanceAvailable = true;

      const pub = await this.fetchERC20Balance(token.address, accountAddress, rpcUrls);
      publicBalance = pub.balance;
      publicBalanceAvailable = pub.ok;
      if (!pub.ok) {
        console.warn(`Could not fetch public balance for ${token.symbol} (all RPCs unreachable).`);
      }

      results.push({
        token,
        publicBalance,
        publicBalanceAvailable,
        shieldedBalance: 0n,
        shieldedBalanceAvailable: false,
        pendingNotesCount: 0,
        privacyApiSupported: false,
      });
    }

    return results;
  }

  /**
   * Safe transaction wait with ceiling timeout per Wallet API gotchas
   */
  async waitForTxWithTimeout(txHash: string, timeoutMs = 15000, rpcUrl?: string): Promise<boolean> {
    try {
      const provider = rpcUrl ? new RpcProvider({ nodeUrl: rpcUrl }) : this.defaultRpcProvider;
      const waitPromise = provider.waitForTransaction(txHash);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), timeoutMs));
      const res = await Promise.race([waitPromise, timeoutPromise]);
      return res !== 'TIMEOUT';
    } catch {
      return false;
    }
  }

  /**
   * LEGACY — UNREACHABLE from the UI. Generic STRK20 shield now runs through the
   * Wallet API lane (strk20WalletApiService.shield). This stub FAILS CLOSED and never
   * writes a fake note or performs a public ERC-20 transfer to the pool.
   */
  async executeShield(
    _walletAccount: any,
    _token: TokenInfo,
    _amountBigInt: bigint,
    _onStepChange?: (step: 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED') => void,
    _poolAddress?: string,
    _networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    throw new Error(
      'STRK20 shield must run through the privacy wallet (Wallet API lane). No funds were moved.',
    );
  }

  /**
   * LEGACY — UNREACHABLE from the UI. Private transfers run through the Wallet API lane
   * (strk20WalletApiService.privateTransfer). Fails closed; never falls back to a public
   * ERC-20 transfer and never writes local note state.
   */
  async executePrivateTransfer(
    _walletAccount: any,
    _token: TokenInfo,
    _recipientViewingKeyOrAddress: string,
    _amountBigInt: bigint,
    _onStepChange?: (step: 'PREPARING' | 'PROVING' | 'SUBMITTING') => void,
    _poolAddress?: string,
    _networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    throw new Error(
      'STRK20 private transfers must run through the privacy wallet (Wallet API lane).',
    );
  }

  /**
   * LEGACY — UNREACHABLE from the UI. Unshield runs through the Wallet API lane
   * (strk20WalletApiService.unshield). Fails closed; never drains a public wallet.
   */
  async executeUnshield(
    _walletAccount: any,
    _token: TokenInfo,
    _destinationAddress: string,
    _amountBigInt: bigint,
    _onStepChange?: (step: 'PROVING' | 'SUBMITTING') => void,
    _poolAddress?: string,
    _networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    throw new Error(
      'STRK20 unshield must run through the privacy wallet (Wallet API lane). No funds were moved.',
    );
  }
}

export const privacyService = new PrivacyService();
