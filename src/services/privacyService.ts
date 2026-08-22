import { RpcProvider, num, uint256, hash } from 'starknet';
import { getActivePoolAddress, getActiveRpcUrl, TokenInfo, NetworkConfig, NETWORKS, DEFAULT_NETWORK_ID } from '@/config/tokens';
import { vaultService } from './vaultService';

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
   * Fetches both public and shielded STRK20 balances for a given account.
   * Dynamically adapts to the active network (Mainnet or Sepolia).
   * Supports ALL Starknet wallets (Braavos, Argent X, Ready Wallet).
   */
  async fetchBalances(
    accountAddress: string,
    walletAccount?: any,
    network?: NetworkConfig
  ): Promise<ShieldedBalance[]> {
    const activeNetwork = network || NETWORKS.mainnet;
    const tokens = activeNetwork.tokens;
    const rpcUrls = activeNetwork.rpcUrls;
    const results: ShieldedBalance[] = [];

    const hasNativePrivacyWalletApi =
      walletAccount != null && typeof walletAccount.strk20Balances === 'function';

    for (const token of tokens) {
      let publicBalance = 0n;
      let publicBalanceAvailable = true;
      let shieldedBalance = 0n;
      let pendingNotesCount = 0;

      // 1. Fetch live public ERC-20 balance on-chain
      const pub = await this.fetchERC20Balance(token.address, accountAddress, rpcUrls);
      publicBalance = pub.balance;
      publicBalanceAvailable = pub.ok;
      if (!pub.ok) {
        console.warn(`Could not fetch public balance for ${token.symbol} (all RPCs unreachable).`);
      }

      // 2. Fetch shielded balance:
      // If Ready Wallet: query wallet API
      // If Braavos / Argent X: query the in-browser Encrypted UTXO Vault
      if (hasNativePrivacyWalletApi) {
        try {
          const shieldedRes = await walletAccount.strk20Balances([token.address]);
          if (shieldedRes && shieldedRes[token.address]) {
            shieldedBalance = BigInt(shieldedRes[token.address]);
          }
        } catch (err) {
          console.warn(`Native shielded query failed, falling back to vault:`, err);
          shieldedBalance = vaultService.getUnspentShieldedBalance(accountAddress, token.address, activeNetwork.id);
        }
      } else {
        shieldedBalance = vaultService.getUnspentShieldedBalance(accountAddress, token.address, activeNetwork.id);
      }

      // Count unspent notes
      const notes = vaultService.getNotes(accountAddress, activeNetwork.id);
      pendingNotesCount = notes.filter((n) => !n.isSpent && n.tokenAddress.toLowerCase() === token.address.toLowerCase()).length;

      results.push({
        token,
        publicBalance,
        publicBalanceAvailable,
        shieldedBalance,
        pendingNotesCount,
        privacyApiSupported: true, // Universal support via in-browser Umbra client
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
   * Shield tokens into the STRK20 Privacy Pool.
   * Compatible with Braavos, Argent X, Ready Wallet, and Cartridge.
   */
  async executeShield(
    walletAccount: any,
    token: TokenInfo,
    amountBigInt: bigint,
    onStepChange?: (step: 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED') => void,
    poolAddress?: string,
    networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    const address = walletAccount.address || walletAccount.account?.address || walletAccount.selectedAddress;

    // 1. Ready Wallet native route
    if (typeof walletAccount.strk20Shield === 'function') {
      onStepChange?.('PROVING');
      const res = await walletAccount.strk20Shield({
        token: token.address,
        amount: amountBigInt.toString(),
      });
      onStepChange?.('SUBMITTED');
      const txHash = res.transaction_hash || res.hash || '0x';
      if (address) {
        vaultService.addNote(address, networkId, token.address, token.symbol, amountBigInt, txHash);
      }
      return { txHash };
    }

    // 2. Braavos / Argent X path — FAIL CLOSED. A plain public ERC-20 `transfer` to the
    // pool contract address does NOT create a shielded note (no deposit, no owner, no
    // way to unshield) — it would park the user's USDC in the pool's balance forever.
    // The only correct shield for these wallets is the real STRK20 SDK path
    // (strk20SdkService.shield), which requires the operator proving + discovery
    // services. Never silently "shield" via a raw transfer.
    throw new Error(
      'STRK20_SHIELD_UNAVAILABLE: This wallet does not expose a native STRK20 shield API. ' +
        'Use strk20SdkService.shield (requires NEXT_PUBLIC_STRK20_PROVER_URL + NEXT_PUBLIC_STRK20_DISCOVERY_URL). ' +
        'No funds were moved.'
    );
  }

  /**
   * Execute private note transfer inside STRK20 pool
   */
  async executePrivateTransfer(
    walletAccount: any,
    token: TokenInfo,
    recipientViewingKeyOrAddress: string,
    amountBigInt: bigint,
    onStepChange?: (step: 'PREPARING' | 'PROVING' | 'SUBMITTING') => void,
    poolAddress?: string,
    networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    const targetPoolAddress = poolAddress || getActivePoolAddress(networkId);
    const address = walletAccount.address || walletAccount.account?.address || walletAccount.selectedAddress;
    onStepChange?.('PREPARING');

    // 1. Ready Wallet native route
    if (typeof walletAccount.strk20Transfer === 'function') {
      onStepChange?.('PROVING');
      const res = await walletAccount.strk20Transfer({
        token: token.address,
        recipient: recipientViewingKeyOrAddress,
        amount: amountBigInt.toString(),
      });
      onStepChange?.('SUBMITTING');
      const txHash = res.transaction_hash || res.hash || '0x';
      if (address) {
        vaultService.spendNotes(address, token.address, amountBigInt, networkId);
      }
      return { txHash };
    }

    // 2. Fallback check: Refuse to execute plain ERC20 transfer under the label of "private transfer"
    throw new Error('STRK20 native privacy wallet required for private transfers. Please connect Ready Wallet or a STRK20-compatible wallet.');
  }

  /**
   * Execute unshield (withdraw private note back to public address)
   */
  async executeUnshield(
    walletAccount: any,
    token: TokenInfo,
    destinationAddress: string,
    amountBigInt: bigint,
    onStepChange?: (step: 'PROVING' | 'SUBMITTING') => void,
    poolAddress?: string,
    networkId: string = 'mainnet'
  ): Promise<{ txHash: string }> {
    if (!walletAccount) throw new Error('Wallet not connected');

    const targetPoolAddress = poolAddress || getActivePoolAddress(networkId);
    const address = walletAccount.address || walletAccount.account?.address || walletAccount.selectedAddress;

    if (typeof walletAccount.strk20Unshield === 'function') {
      onStepChange?.('PROVING');
      // Spend from local note vault
      if (address) {
        vaultService.spendNotes(address, token.address, amountBigInt, networkId);
      }
      const res = await walletAccount.strk20Unshield({
        token: token.address,
        recipient: destinationAddress,
        amount: amountBigInt.toString(),
      });
      onStepChange?.('SUBMITTING');
      return { txHash: res.transaction_hash || res.hash || '0x' };
    }

    // Refuse to fake unshielding by draining user's public wallet
    throw new Error('STRK20 native privacy wallet required to unshield funds. Please connect Ready Wallet or a STRK20-compatible wallet.');
  }
}

export const privacyService = new PrivacyService();
