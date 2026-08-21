/**
 * @file starknetPerpsDispatcher.ts
 * @description Starknet On-Chain Dispatcher for PEL Private Perpetuals
 * Encodes and dispatches real Cairo contract transactions with Groth16 zk-SNARK proof calldata.
 */

import { Call, RpcProvider, uint256 } from 'starknet';

export interface DeploymentConfig {
  network: 'sepolia';
  pelCoreAddress: string;
  strk20AdapterAddress: string;
  oracleAdapterAddress: string;
  openVerifierAddress: string;
  updateVerifierAddress: string;
  fundVerifierAddress: string;
  closeVerifierAddress: string;
  liquidateVerifierAddress: string;
  stwoVerifierAddress: string;
  collateralTokenAddress: string;
}

export const PERPS_DEPLOYMENTS: Record<'sepolia', DeploymentConfig> = {
  sepolia: {
    network: 'sepolia',
    pelCoreAddress: process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA || '0x658e68d9a311bcdd56d98d3ebbcebff2ddd43463547bab859d4d12092444c2b',
    strk20AdapterAddress: process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA || '0xb0eefeb3c52b062ab63736e93355034058688cbfb8ccba7b7f75261b3f4897',
    oracleAdapterAddress: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA || '0x29e641f5fa56d527a08b22a65bbc27d9cb27694fa983fa150329ade094e1f',
    openVerifierAddress: process.env.NEXT_PUBLIC_OPEN_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    updateVerifierAddress: process.env.NEXT_PUBLIC_UPDATE_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    fundVerifierAddress: process.env.NEXT_PUBLIC_FUND_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    closeVerifierAddress: process.env.NEXT_PUBLIC_CLOSE_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    liquidateVerifierAddress: process.env.NEXT_PUBLIC_LIQUIDATE_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    stwoVerifierAddress: process.env.NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA || '0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde',
    collateralTokenAddress: process.env.NEXT_PUBLIC_TEST_USDC_SEPOLIA || '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
  },
};

export interface ExecutionResult {
  transactionHash: string;
  explorerUrl: string;
  blockNumber?: number;
  status: 'PENDING' | 'CONFIRMED' | 'SUCCESS';
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
      const formattedProof = this.formatCalldata(proofCalldata);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'open_position',
        calldata: [
          collateralOwner,
          marketFelt,
          marginAmountFelt,
          '0x' + formattedProof.length.toString(16),
          ...formattedProof,
        ],
      };
    } else {
      // Legacy Signature: (collateralOwner, marketId, commitment, marginNullifier, marginAmountUsd, factHash)
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
      const formattedProof = this.formatCalldata(arg2);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'update_position',
        calldata: [
          marketFelt,
          '0x' + formattedProof.length.toString(16),
          ...formattedProof,
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
      const formattedProof = this.formatCalldata(proofCalldata);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'fund_position',
        calldata: [
          marketFelt,
          fundingAmountFelt,
          isLongPays ? '0x1' : '0x0',
          '0x' + formattedProof.length.toString(16),
          ...formattedProof,
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
      const formattedProof = this.formatCalldata(arg3);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'close_position',
        calldata: [
          marketFelt,
          recipient,
          '0x' + formattedProof.length.toString(16),
          ...formattedProof,
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
      const formattedProof = this.formatCalldata(arg3);
      return {
        contractAddress: config.pelCoreAddress,
        entrypoint: 'liquidate_position',
        calldata: [
          marketFelt,
          keeperRecipient,
          '0x' + formattedProof.length.toString(16),
          ...formattedProof,
        ],
      };
    } else {
      // Legacy: marketId, posCommitment, posNullifier, factHash, keeperAddress
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

  /**
   * Query on-chain position record from PELPerpsCore
   */
  async getPositionOnChain(
    commitmentKey: string,
    network: 'sepolia' = 'sepolia'
  ): Promise<{ isOpen: boolean; lockedMargin: bigint; marketId: string }> {
    try {
      const config = PERPS_DEPLOYMENTS[network];
      const res = await this.provider.callContract({
        contractAddress: config.pelCoreAddress,
        entrypoint: 'get_position',
        calldata: [commitmentKey],
      });

      if (res && res.length >= 6) {
        const isActive = res[5] === '0x1' || res[5] === '1';
        return {
          isOpen: isActive,
          lockedMargin: BigInt(res[2] || '0'),
          marketId: 'BTC-PERP',
        };
      }
      return { isOpen: false, lockedMargin: 0n, marketId: 'BTC-PERP' };
    } catch {
      return { isOpen: false, lockedMargin: 0n, marketId: 'BTC-PERP' };
    }
  }

  /**
   * Execute real transaction on Starknet via browser account
   */
  async executeOnChain(browserAccount: any, call: Call, _network: 'sepolia' = 'sepolia'): Promise<ExecutionResult> {
    if (!browserAccount) {
      throw new Error('No Starknet account connected. Please connect Argent X or Braavos.');
    }

    try {
      const response = await browserAccount.execute(call);
      const txHash = response.transaction_hash;
      const explorerUrl = `https://sepolia.voyager.online/tx/${txHash}`;

      return {
        transactionHash: txHash,
        explorerUrl,
        status: 'PENDING',
      };
    } catch (err: any) {
      console.error('[StarknetPerpsDispatcher] Transaction execution failed:', err);
      throw new Error(`Starknet Execution Error: ${err.message || 'Unknown transaction failure'}`);
    }
  }
}

export const starknetPerpsDispatcher = new StarknetPerpsDispatcher();
