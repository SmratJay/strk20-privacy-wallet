/**
 * @file starknetPerpsDispatcher.ts
 * @description Starknet On-Chain Dispatcher for PEL Private Perpetuals
 * Encodes and dispatches real Cairo contract transactions with Groth16 zk-SNARK proof calldata.
 */

import { Call, RpcProvider, uint256 } from 'starknet';
import { USDC_SEPOLIA as STRK20_USDC_SEPOLIA } from './strk20SdkService';

export interface DeploymentConfig {
  network: 'sepolia';
  pelCoreAddress: string;
  strk20AdapterAddress: string;
  pelStrk20BridgeAddress: string;
  oracleAdapterAddress: string;
  openVerifierAddress: string;
  updateVerifierAddress: string;
  fundVerifierAddress: string;
  closeVerifierAddress: string;
  liquidateVerifierAddress: string;
  stwoVerifierAddress: string;
  collateralTokenAddress: string;
  // Canonical LP counterparty integration (P0). The LP vault is the economic
  // counterparty; insurance and treasury are its real sub-components.
  lpVaultAddress: string;
  insuranceReserveAddress: string;
  treasuryAddress: string;
}

export const PERPS_DEPLOYMENTS: Record<'sepolia', DeploymentConfig> = {
  sepolia: {
    network: 'sepolia',
    pelCoreAddress: process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA || '0x658e68d9a311bcdd56d98d3ebbcebff2ddd43463547bab859d4d12092444c2b',
    strk20AdapterAddress: process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA || '0xb0eefeb3c52b062ab63736e93355034058688cbfb8ccba7b7f75261b3f4897',
    pelStrk20BridgeAddress: process.env.NEXT_PUBLIC_STRK20_BRIDGE_SEPOLIA || '',
    oracleAdapterAddress: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA || '0x29e641f5fa56d527a08b22a65bbc27d9cb27694fa983fa150329ade094e1f',
    // The five circuit-specific Groth16 verifiers MUST be distinct contracts.
    // Fail-closed: no shared fallback address (previously all five silently resolved
    // to the StwoVerifier fact-registry address).
    openVerifierAddress: process.env.NEXT_PUBLIC_OPEN_VERIFIER_SEPOLIA || '',
    updateVerifierAddress: process.env.NEXT_PUBLIC_UPDATE_VERIFIER_SEPOLIA || '',
    fundVerifierAddress: process.env.NEXT_PUBLIC_FUND_VERIFIER_SEPOLIA || '',
    closeVerifierAddress: process.env.NEXT_PUBLIC_CLOSE_VERIFIER_SEPOLIA || '',
    liquidateVerifierAddress: process.env.NEXT_PUBLIC_LIQUIDATE_VERIFIER_SEPOLIA || '',
    stwoVerifierAddress: process.env.NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    collateralTokenAddress: process.env.NEXT_PUBLIC_TEST_USDC_SEPOLIA || '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343',
    lpVaultAddress: process.env.NEXT_PUBLIC_LP_VAULT_SEPOLIA || '',
    insuranceReserveAddress: process.env.NEXT_PUBLIC_LP_INSURANCE_SEPOLIA || '',
    treasuryAddress: process.env.NEXT_PUBLIC_LP_TREASURY_SEPOLIA || '',
  },
};

const ZERO_ADDRESS = '0x0';

/**
 * Validate a deployment config's five Groth16 verifier addresses.
 * Returns a list of human-readable problems (empty array == valid).
 * Enforces: every address present, nonzero, and pairwise distinct.
 */
export function validateVerifierAddresses(config: DeploymentConfig): string[] {
  const problems: string[] = [];
  const addrs: Array<[string, string]> = [
    ['open', config.openVerifierAddress],
    ['update', config.updateVerifierAddress],
    ['fund', config.fundVerifierAddress],
    ['close', config.closeVerifierAddress],
    ['liquidate', config.liquidateVerifierAddress],
  ];
  const seen = new Set<string>();
  for (const [name, addr] of addrs) {
    const normalized = addr?.toLowerCase() ?? '';
    if (!normalized || normalized === ZERO_ADDRESS) {
      problems.push(`${name}VerifierAddress is unset or zero`);
      continue;
    }
    if (seen.has(normalized)) {
      problems.push(`${name}VerifierAddress duplicates another verifier address (${normalized})`);
    }
    seen.add(normalized);
  }
  return problems;
}

/**
 * Validate that the canonical collateral asset is consistent across the whole stack.
 * P0 rule: STRK20 USDC == PEL collateral == payout == accounting unit == LP asset ==
 * insurance asset. One token, everywhere.
 */
export function validateCanonicalCollateral(config: DeploymentConfig): string[] {
  const problems: string[] = [];
  const pelCollateral = (config.collateralTokenAddress || '').toLowerCase();
  const strk20Usdc = STRK20_USDC_SEPOLIA.toLowerCase();
  if (!pelCollateral) {
    problems.push('collateralTokenAddress is unset');
  } else if (pelCollateral !== strk20Usdc) {
    problems.push(
      `CANONICAL_COLLATERAL_MISMATCH: PEL collateral (${config.collateralTokenAddress}) ` +
        `!= STRK20 USDC (${STRK20_USDC_SEPOLIA}). The protocol must use ONE canonical collateral token.`,
    );
  }
  return problems;
}

/** Full deployment config validation: verifiers + canonical collateral. */
export function validateDeploymentConfig(config: DeploymentConfig): string[] {
  return [...validateVerifierAddresses(config), ...validateCanonicalCollateral(config)];
}

/**
 * Validate the canonical LP counterparty deployment (vault / insurance / treasury).
 * FAIL-CLOSED: no component may guess another component's address. If any LP
 * deployment address is absent, the LP subsystem is NOT deployable.
 */
export function validateLpDeployment(config: DeploymentConfig): string[] {
  const problems: string[] = [];
  const entries: Array<[string, string]> = [
    ['lpVaultAddress', config.lpVaultAddress],
    ['insuranceReserveAddress', config.insuranceReserveAddress],
    ['treasuryAddress', config.treasuryAddress],
  ];
  for (const [name, addr] of entries) {
    const normalized = addr?.toLowerCase() ?? '';
    if (!normalized || normalized === '0x0') {
      problems.push(`${name} is unset or zero — LP counterparty FAILS CLOSED`);
    }
  }
  // The vault must never be inferred as the STRK20 adapter (a previous bug).
  if (config.lpVaultAddress && config.strk20AdapterAddress &&
      config.lpVaultAddress.toLowerCase() === config.strk20AdapterAddress.toLowerCase()) {
    problems.push('lpVaultAddress MUST NOT equal strk20AdapterAddress');
  }
  return problems;
}

export interface ExecutionResult {
  transactionHash: string;
  explorerUrl: string;
  blockNumber?: number;
  status: 'PENDING' | 'SUCCESS' | 'REVERTED' | 'REJECTED';
}

export class StarknetPerpsDispatcher {
  private provider: RpcProvider;

  constructor(rpcUrl: string = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia') {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  private marketToFelt(marketId: string): string {
    return '0x' + Buffer.from(marketId).toString('hex');
  }

  private formatCalldata(calldata: (bigint | string | number)[]): string[] {
    return calldata.map((x) => (typeof x === 'bigint' ? '0x' + x.toString(16) : typeof x === 'number' ? '0x' + x.toString(16) : x.startsWith('0x') ? x : '0x' + x));
  }

  private encodeProofSpan(proofCalldata: (bigint | string | number)[]): string[] {
    if (!proofCalldata || proofCalldata.length === 0) return ['0x0'];
    const first = BigInt(proofCalldata[0]);
    const expectedRemaining = BigInt(proofCalldata.length - 1);
    if (first === expectedRemaining) {
      // Already formatted with span length header (standard Garaga getGroth16CallData output format)
      return this.formatCalldata(proofCalldata);
    }
    const formatted = this.formatCalldata(proofCalldata);
    return ['0x' + formatted.length.toString(16), ...formatted];
  }

  /**
   * Builds ERC20 approve call for collateral token (e.g. TestUSDC)
   */
  buildApproveCall(
    spenderAddress: string,
    amountCents: bigint,
    tokenAddress?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const targetToken = tokenAddress || config.collateralTokenAddress;
    const tokenUnits = amountCents * 10_000n;
    const u256Val = uint256.bnToUint256(tokenUnits);

    return {
      contractAddress: targetToken,
      entrypoint: 'approve',
      calldata: [
        spenderAddress,
        '0x' + BigInt(u256Val.low).toString(16),
        '0x' + BigInt(u256Val.high).toString(16),
      ],
    };
  }

  /**
   * Builds the call to PELPerpsCore.open_position (supports Groth16 calldata & legacy fact signatures)
   */
  buildOpenPositionCall(
    collateralOwner: string,
    marketId: 'BTC-PERP' = 'BTC-PERP',
    arg3?: number | string,
    arg4?: (bigint | string)[] | string,
    arg5?: number,
    arg6?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    if (typeof arg3 === 'number') {
      // Groth16 Signature: (collateralOwner, marketId, marginAmountUsd, proofCalldata)
      const marginAmountUsd = arg3;
      const proofCalldata = Array.isArray(arg4) ? arg4 : [];
      const marginAmountFelt = '0x' + Math.floor(marginAmountUsd * 100).toString(16);
      const encodedSpan = this.encodeProofSpan(proofCalldata);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'open_position',
        calldata: [
          collateralOwner,
          marketFelt,
          marginAmountFelt,
          ...encodedSpan,
        ],
      };
    } else {
      // ⚠️ LEGACY-ONLY BRANCH (isolated for historical tests). NOT reachable from the
      // production UI — the canonical user-facing OPEN goes through
      // strk20SdkService.openPerpPosition → STRK20 pool → PELPerpsSTRK20Bridge →
      // PELPerpsCore.open_position_shielded. This legacy signature builds the obsolete
      // fact-based open call and MUST NOT be used by production code.
      const commitment = arg3 || '0x0';
      const marginNullifier = (arg4 as string) || '0x0';
      const marginAmountUsd = typeof arg5 === 'number' ? arg5 : 0;
      const factHash = arg6 || '0x0';
      const marginAmountFelt = '0x' + Math.floor(marginAmountUsd * 100).toString(16);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'open_position',
        calldata: [
          collateralOwner,
          marketFelt,
          commitment,
          marginNullifier,
          marginAmountFelt,
          factHash,
        ],
      };
    }
  }

  /**
   * Builds the call to PELPerpsCore.update_position
   */
  buildUpdatePositionCall(
    marketId: 'BTC-PERP' = 'BTC-PERP',
    arg2?: (bigint | string)[] | string,
    arg3?: string,
    arg4?: string,
    arg5?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    if (Array.isArray(arg2)) {
      const encodedSpan = this.encodeProofSpan(arg2);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'update_position',
        calldata: [
          marketFelt,
          ...encodedSpan,
        ],
      };
    } else {
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'update_position',
        calldata: [
          marketFelt,
          arg2 || '0x0',
          arg3 || '0x0',
          arg4 || '0x0',
          arg5 || '0x0',
        ],
      };
    }
  }

  /**
   * Builds the call to PELPerpsCore.fund_position
   */
  buildFundPositionCall(
    marketId: 'BTC-PERP' = 'BTC-PERP',
    arg2?: number | string,
    arg3?: boolean | string,
    arg4?: (bigint | string)[] | string,
    arg5?: bigint | string,
    arg6?: boolean,
    arg7?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    if (typeof arg2 === 'number') {
      const fundingAmountUsd = arg2;
      const isLongPays = Boolean(arg3);
      const proofCalldata = Array.isArray(arg4) ? arg4 : [];
      const fundingAmountFelt = '0x' + Math.floor(fundingAmountUsd * 100).toString(16);
      const encodedSpan = this.encodeProofSpan(proofCalldata);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'fund_position',
        calldata: [
          marketFelt,
          fundingAmountFelt,
          isLongPays ? '0x1' : '0x0',
          ...encodedSpan,
        ],
      };
    } else {
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'fund_position',
        calldata: [
          marketFelt,
          arg2 as string,
          arg3 as string,
          arg4 as string,
          (arg5 as string) || '0x0',
          arg6 ? '0x1' : '0x0',
          arg7 || '0x0',
        ],
      };
    }
  }

  /**
   * Builds the call to PELPerpsCore.close_position
   */
  buildClosePositionCall(
    recipient: string,
    marketId: 'BTC-PERP' = 'BTC-PERP',
    arg3?: (bigint | string)[] | string,
    arg4?: string,
    arg5?: string,
    arg6?: number,
    arg7?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    if (Array.isArray(arg3)) {
      const encodedSpan = this.encodeProofSpan(arg3);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'close_position',
        calldata: [
          marketFelt,
          recipient,
          ...encodedSpan,
        ],
      };
    } else {
      const positionCommitment = arg3 || '0x0';
      const finalNullifier = arg4 || '0x0';
      const payoutNoteCommitment = arg5 || '0x0';
      const payoutAmountUsd = typeof arg6 === 'number' ? arg6 : 0;
      const factHash = arg7 || '0x0';
      const payoutAmountFelt = '0x' + Math.floor(payoutAmountUsd * 100).toString(16);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'close_position',
        calldata: [
          marketFelt,
          positionCommitment,
          finalNullifier,
          payoutNoteCommitment,
          payoutAmountFelt,
          recipient,
          factHash,
        ],
      };
    }
  }

  /**
   * Builds the call to PELPerpsCore.liquidate_position
   */
  buildLiquidatePositionCall(
    keeperRecipient: string,
    marketId: 'BTC-PERP' = 'BTC-PERP',
    arg3?: (bigint | string)[] | string,
    arg4?: string,
    arg5?: string,
    arg6?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    if (Array.isArray(arg3)) {
      const encodedSpan = this.encodeProofSpan(arg3);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'liquidate_position',
        calldata: [
          marketFelt,
          keeperRecipient,
          ...encodedSpan,
        ],
      };
    } else {
      // ⚠️ LEGACY-ONLY BRANCH (isolated for historical tests). The production keeper and
      // UI liquidations use the canonical Groth16 calldata signature; this obsolete
      // fact-based liquidation call MUST NOT be used by production code.
      const posCommitment = arg3 || '0x0';
      const posNullifier = arg4 || '0x0';
      const factHash = arg5 || '0x0';
      const keeper = arg6 || keeperRecipient;
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'liquidate_position',
        calldata: [
          this.marketToFelt(keeperRecipient), // marketId was 1st param in legacy
          posCommitment,
          posNullifier,
          factHash,
          keeper,
        ],
      };
    }
  }

  /**
   * Builds the call to STRK20Adapter.claim_payout
   */
  buildClaimPayoutCall(
    nullifier: string,
    payoutNoteCommitment: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'claim_payout',
      calldata: [nullifier, payoutNoteCommitment],
    };
  }

  /**
   * Builds the call to STRK20Adapter.claim_keeper_bounty
   */
  buildClaimKeeperBountyCall(
    keeperAddress: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'claim_keeper_bounty',
      calldata: [keeperAddress],
    };
  }

  // ─── CANONICAL LP VAULT CALLS (PELLiquidityVault = the counterparty) ───────

  buildVaultDepositCall(amountCents: bigint, network: 'sepolia' = 'sepolia'): Call[] {
    const config = PERPS_DEPLOYMENTS[network];
    const vault = config.lpVaultAddress;
    if (!vault) throw new Error('LP_VAULT_NOT_CONFIGURED');
    return [
      this.buildApproveCall(vault, amountCents, config.collateralTokenAddress, network),
      { contractAddress: vault, entrypoint: 'deposit_liquidity', calldata: [amountCents.toString()] },
    ];
  }

  buildVaultRequestWithdrawalCall(shares: bigint, network: 'sepolia' = 'sepolia'): Call {
    const config = PERPS_DEPLOYMENTS[network];
    if (!config.lpVaultAddress) throw new Error('LP_VAULT_NOT_CONFIGURED');
    return {
      contractAddress: config.lpVaultAddress,
      entrypoint: 'request_withdrawal',
      calldata: [shares.toString()],
    };
  }

  buildVaultClaimWithdrawalCall(requestId: bigint, network: 'sepolia' = 'sepolia'): Call {
    const config = PERPS_DEPLOYMENTS[network];
    if (!config.lpVaultAddress) throw new Error('LP_VAULT_NOT_CONFIGURED');
    return {
      contractAddress: config.lpVaultAddress,
      entrypoint: 'claim_withdrawal',
      calldata: [requestId.toString()],
    };
  }

  buildVaultClaimPayoutCall(payoutNullifier: bigint, noteCommitment: bigint, network: 'sepolia' = 'sepolia'): Call {
    const config = PERPS_DEPLOYMENTS[network];
    if (!config.lpVaultAddress) throw new Error('LP_VAULT_NOT_CONFIGURED');
    return {
      contractAddress: config.lpVaultAddress,
      entrypoint: 'claim_payout_note',
      calldata: [payoutNullifier.toString(), noteCommitment.toString()],
    };
  }

  /**
   * Query on-chain position record from PELPerpsCore
   */
  async getPositionOnChain(
    commitmentKey: string,
    network: 'sepolia' = 'sepolia'
  ): Promise<{ isOpen: boolean; status: 'OPEN' | 'CLOSED' | 'UNKNOWN'; lockedMargin: bigint; marketId: string }> {
    try {
      const config = PERPS_DEPLOYMENTS[network];
      const res = await this.provider.callContract({
        contractAddress: config.pelCoreAddress,
        entrypoint: 'get_position',
        calldata: [commitmentKey],
      });

      // PositionRecord (Cairo) field order:
      // [0] commitment [1] margin_nullifier [2] locked_margin [3] market_id
      // [4] created_at [5] updated_at [6] last_funding_timestamp [7] is_active
      if (res && res.length >= 8) {
        const isActive = res[7] === '0x1' || res[7] === '1';
        return {
          isOpen: isActive,
          status: isActive ? 'OPEN' : 'CLOSED',
          lockedMargin: BigInt(res[2] || '0'),
          marketId: 'BTC-PERP',
        };
      }
      return { isOpen: false, status: 'CLOSED', lockedMargin: 0n, marketId: 'BTC-PERP' };
    } catch {
      return { isOpen: false, status: 'UNKNOWN', lockedMargin: 0n, marketId: 'BTC-PERP' };
    }
  }

  /**
   * Query the canonical collateral token balance (token base units) for an address.
   * Used to verify actual payout delivery — never trusts tx status alone.
   */
  async getTokenBalance(
    accountAddress: string,
    tokenAddress?: string,
    network: 'sepolia' = 'sepolia'
  ): Promise<bigint> {
    const config = PERPS_DEPLOYMENTS[network];
    const token = tokenAddress || config.collateralTokenAddress;
    const res = await this.provider.callContract({
      contractAddress: token,
      entrypoint: 'balance_of',
      calldata: [accountAddress],
    });
    const low = res?.[0]?.toString?.() ?? '0x0';
    const high = res?.[1]?.toString?.() ?? '0x0';
    const lowBig = BigInt(low === '0x' ? '0x0' : low);
    const highBig = BigInt(high === '0x' ? '0x0' : high);
    return (highBig << 128n) | lowBig;
  }

  /**
   * Execute real transaction on Starknet via browser account and wait for finality.
   * Returns SUCCESS / REVERTED / REJECTED — never treats `execute()` submission as
   * proof of a successful state transition.
   */
  async executeOnChain(browserAccount: any, call: Call, _network: 'sepolia' = 'sepolia'): Promise<ExecutionResult> {
    if (!browserAccount) {
      throw new Error('No Starknet account connected. Please connect Argent X or Braavos.');
    }

    const explorerUrl = (txHash: string) => `https://sepolia.voyager.online/tx/${txHash}`;

    try {
      const response = await browserAccount.execute(call);
      const txHash = response.transaction_hash;
      if (!txHash) {
        return { transactionHash: '', explorerUrl: '', status: 'REJECTED' };
      }

      // Wait for acceptance (or revert) using the RPC provider.
      const receipt: any = await this.provider.waitForTransaction(txHash, { retryInterval: 2000 });
      const executionStatus = receipt?.execution_status ?? receipt?.status ?? 'UNKNOWN';
      const blockNumber = receipt?.block_number;

      if (executionStatus === 'REVERTED' || executionStatus === 'REJECTED') {
        return { transactionHash: txHash, explorerUrl: explorerUrl(txHash), blockNumber, status: 'REVERTED' };
      }
      if (executionStatus === 'SUCCEEDED' || executionStatus === 'ACCEPTED_ON_L2' || executionStatus === 'ACCEPTED_ON_L1') {
        return { transactionHash: txHash, explorerUrl: explorerUrl(txHash), blockNumber, status: 'SUCCESS' };
      }
      return { transactionHash: txHash, explorerUrl: explorerUrl(txHash), blockNumber, status: 'PENDING' };
    } catch (err: any) {
      console.error('[StarknetPerpsDispatcher] Transaction execution failed:', err);
      throw new Error(`Starknet Execution Error: ${err.message || 'Unknown transaction failure'}`);
    }
  }
}

export const starknetPerpsDispatcher = new StarknetPerpsDispatcher();
