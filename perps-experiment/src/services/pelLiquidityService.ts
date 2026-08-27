/**
 * @file src/services/pelLiquidityService.ts
 * @description Client Service for Querying and Interacting with the canonical
 * PELLiquidityVault (the LP counterparty). FAIL-CLOSED: no fabricated pool metrics,
 * no fallback to the STRK20 adapter address.
 */

import { Contract, RpcProvider, Call } from 'starknet';
import { LPVaultState, LPVaultEngine, TOKEN_DECIMAL_MULTIPLIER } from '../protocol/lpVault';
import { PERPS_DEPLOYMENTS, validateLpDeployment } from './starknetPerpsDispatcher';

export interface PoolMetrics extends LPVaultState {
  sharePriceE6: bigint;
  utilizationBps: number;
  availableLiquidityCents: bigint;
  economicNavCents: bigint;
  poolReceivableCents: bigint;
}

export class PELLiquidityService {
  private provider: RpcProvider;
  private vaultAddress: string;
  private insuranceAddress: string;
  private treasuryAddress: string;

  constructor(rpcUrl?: string, vaultAddress?: string) {
    this.provider = new RpcProvider({
      nodeUrl: rpcUrl || process.env.NEXT_PUBLIC_STARKNET_RPC || 'http://127.0.0.1:5050',
    });
    const cfg = PERPS_DEPLOYMENTS.sepolia;
    this.vaultAddress = vaultAddress || cfg.lpVaultAddress;
    this.insuranceAddress = cfg.insuranceReserveAddress;
    this.treasuryAddress = cfg.treasuryAddress;
  }

  private assertConfigured() {
    const cfg = PERPS_DEPLOYMENTS.sepolia;
    const problems = validateLpDeployment(cfg);
    if (problems.length > 0) {
      throw new Error(`LP_DEPLOYMENT_CONFIG_ERROR: ${problems.join('; ')}`);
    }
  }

  setVaultAddress(address: string) {
    this.vaultAddress = address;
  }

  getVaultAddress(): string {
    return this.vaultAddress;
  }

  getInsuranceAddress(): string {
    return this.insuranceAddress;
  }

  getTreasuryAddress(): string {
    return this.treasuryAddress;
  }

  /** Fetch real on-chain pool metrics. Throws (never fabricates) on failure. */
  async fetchPoolMetrics(): Promise<PoolMetrics> {
    this.assertConfigured();
    const { abi } = await this.provider.getClassAt(this.vaultAddress);
    const contract = new Contract({ abi, address: this.vaultAddress, providerOrAccount: this.provider });

    const navRes = await contract.get_pool_nav();
    const sharesRes = await contract.get_total_lp_shares();
    const lockedRes = await contract.get_locked_liquidity();
    const availRes = await contract.get_available_liquidity();
    const utilRes = await contract.get_utilization_bps();
    const priceRes = await contract.get_share_price_e6();
    const treasuryRes = await contract.get_treasury_balance();
    const badDebtRes = await contract.get_bad_debt_total();
    const poolReceivableRes = await contract.get_pool_receivable();
    const poolMarginRes = await contract.get_pool_margin();
    const poolAssetsRes = await contract.get_pool_assets();
    const pendingWithdrawalsRes = await contract.get_pending_withdrawals_total();

    const navCents = BigInt(navRes.toString());
    const totalShares = BigInt(sharesRes.toString());
    const poolMarginCents = BigInt(poolMarginRes.toString());
    // get_locked_liquidity() returns PUBLIC locked + pool-custodied margin combined.
    // The public locked bucket must EXCLUDE pool margin to avoid double counting
    // (LPVaultState.lockedCollateralCents is the public vault-held USDC bucket only).
    const lockedCollateralCents = BigInt(lockedRes.toString()) - poolMarginCents;
    const availableLiquidityCents = BigInt(availRes.toString());
    const utilizationBps = Number(utilRes.toString());
    const sharePriceE6 = BigInt(priceRes.toString());
    const treasuryCents = BigInt(treasuryRes.toString());
    const badDebtCents = BigInt(badDebtRes.toString());
    const poolReceivableCents = BigInt(poolReceivableRes.toString());
    const poolAssetsCents = BigInt(poolAssetsRes.toString());
    const pendingWithdrawalsCents = BigInt(pendingWithdrawalsRes.toString());

    const state: LPVaultState = {
      navCents,
      totalShares,
      lockedCollateralCents,
      poolMarginCents,
      poolAssetsCents,
      insuranceReserveCents: 0n,
      unclaimedPayoutsCents: 0n,
      unclaimedBountiesCents: 0n,
      pendingWithdrawalsCents,
      treasuryCents,
      badDebtCents,
    };

    return {
      ...state,
      sharePriceE6,
      utilizationBps,
      availableLiquidityCents,
      economicNavCents: LPVaultEngine.calcEconomicNav(state),
      poolReceivableCents,
    };
  }

  /** Fetch an LP's on-chain share balance. */
  async fetchLpShares(walletAddress: string): Promise<bigint> {
    this.assertConfigured();
    const { abi } = await this.provider.getClassAt(this.vaultAddress);
    const contract = new Contract({ abi, address: this.vaultAddress, providerOrAccount: this.provider });
    const res = await contract.get_lp_shares_balance(walletAddress);
    return BigInt(res.toString());
  }

  /** Fetch the insurance reserve's on-chain balance (cents). */
  async fetchInsuranceBalance(): Promise<bigint> {
    this.assertConfigured();
    if (!this.insuranceAddress) return 0n;
    const { abi } = await this.provider.getClassAt(this.insuranceAddress);
    const contract = new Contract({ abi, address: this.insuranceAddress, providerOrAccount: this.provider });
    const res = await contract.get_insurance_balance();
    return BigInt(res.toString());
  }

  /** Build approve + deposit_liquidity calls. Returns real Starknet Calls. */
  buildDepositLiquidityCalls(amountCents: bigint, collateralTokenAddress: string): Call[] {
    this.assertConfigured();
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

  /** Build the request_withdrawal call. */
  buildRequestWithdrawalCall(shares: bigint): Call {
    this.assertConfigured();
    return {
      contractAddress: this.vaultAddress,
      entrypoint: 'request_withdrawal',
      calldata: [shares.toString()],
    };
  }

  /** Build the claim_withdrawal call. */
  buildClaimWithdrawalCall(requestId: bigint): Call {
    this.assertConfigured();
    return {
      contractAddress: this.vaultAddress,
      entrypoint: 'claim_withdrawal',
      calldata: [requestId.toString()],
    };
  }

  /** Build the claim_payout_note call. */
  buildClaimPayoutCall(payoutNullifier: bigint, recipientNoteCommitment: bigint): Call {
    this.assertConfigured();
    return {
      contractAddress: this.vaultAddress,
      entrypoint: 'claim_payout_note',
      calldata: [payoutNullifier.toString(), recipientNoteCommitment.toString()],
    };
  }
}

export const pelLiquidityService = new PELLiquidityService();