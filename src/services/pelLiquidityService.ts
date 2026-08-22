/**
 * @file src/services/pelLiquidityService.ts
 * @description Client Service for Querying and Interacting with PELLiquidityVault
 */

import { Contract, RpcProvider, AccountInterface, Call } from 'starknet';
import { LPVaultState, LPVaultEngine, SHARE_SCALE, TOKEN_DECIMAL_MULTIPLIER } from '../protocol/lpVault';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';

export class PELLiquidityService {
  private provider: RpcProvider;
  private vaultAddress: string;

  constructor(rpcUrl?: string, vaultAddress?: string) {
    this.provider = new RpcProvider({
      nodeUrl: rpcUrl || process.env.NEXT_PUBLIC_STARKNET_RPC || 'http://127.0.0.1:5050',
    });
    this.vaultAddress = vaultAddress || PERPS_DEPLOYMENTS.sepolia.strk20AdapterAddress;
  }

  setVaultAddress(address: string) {
    this.vaultAddress = address;
  }

  getVaultAddress(): string {
    return this.vaultAddress;
  }

  /** Fetch on-chain pool metrics */
  async fetchPoolMetrics(): Promise<LPVaultState & { sharePriceE6: bigint; utilizationBps: number; availableLiquidityCents: bigint }> {
    try {
      const { abi } = await this.provider.getClassAt(this.vaultAddress);
      const contract = new Contract({ abi, address: this.vaultAddress, providerOrAccount: this.provider });

      const navRes = await contract.get_pool_nav();
      const sharesRes = await contract.get_total_lp_shares();
      const lockedRes = await contract.get_locked_liquidity();
      const availRes = await contract.get_available_liquidity();
      const utilRes = await contract.get_utilization_bps();
      const priceRes = await contract.get_share_price_e6();

      const navCents = BigInt(navRes.toString());
      const totalShares = BigInt(sharesRes.toString());
      const lockedCollateralCents = BigInt(lockedRes.toString());
      const availableLiquidityCents = BigInt(availRes.toString());
      const utilizationBps = Number(utilRes.toString());
      const sharePriceE6 = BigInt(priceRes.toString());

      return {
        navCents,
        totalShares,
        lockedCollateralCents,
        insuranceReserveCents: 0n,
        unclaimedPayoutsCents: 0n,
        unclaimedBountiesCents: 0n,
        pendingWithdrawalsCents: 0n,
        sharePriceE6,
        utilizationBps,
        availableLiquidityCents,
      };
    } catch (err) {
      // Fallback deterministic default state
      const fallbackState: LPVaultState = {
        navCents: 1_000_000_00n, // ,000,000.00
        totalShares: 10_000_000_000n,
        lockedCollateralCents: 150_000_00n, // ,000.00
        insuranceReserveCents: 50_000_00n,  // ,000.00
        unclaimedPayoutsCents: 0n,
        unclaimedBountiesCents: 0n,
        pendingWithdrawalsCents: 0n,
      };
      return {
        ...fallbackState,
        sharePriceE6: LPVaultEngine.calcSharePriceE6(fallbackState.navCents, fallbackState.totalShares),
        utilizationBps: LPVaultEngine.calcUtilizationBps(fallbackState),
        availableLiquidityCents: LPVaultEngine.calcAvailableLiquidity(fallbackState),
      };
    }
  }

  /** Build deposit liquidity call */
  buildDepositLiquidityCall(amountCents: bigint, collateralTokenAddress: string): Call[] {
    const tokenUnits = (amountCents * TOKEN_DECIMAL_MULTIPLIER).toString();
    return [
      {
        contractAddress: collateralTokenAddress,
        entrypoint: 'approve',
        calldata: [this.vaultAddress, tokenUnits, '0x0'],
      },
      {
        contractAddress: this.vaultAddress,
        entrypoint: 'deposit_liquidity',
        calldata: [amountCents.toString()],
      },
    ];
  }

  /** Build request withdrawal call */
  buildRequestWithdrawalCall(shares: bigint): Call {
    return {
      contractAddress: this.vaultAddress,
      entrypoint: 'request_withdrawal',
      calldata: [shares.toString()],
    };
  }

  /** Build claim withdrawal call */
  buildClaimWithdrawalCall(requestId: bigint): Call {
    return {
      contractAddress: this.vaultAddress,
      entrypoint: 'claim_withdrawal',
      calldata: [requestId.toString()],
    };
  }
}

export const pelLiquidityService = new PELLiquidityService();
