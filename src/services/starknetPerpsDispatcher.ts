/**
 * @file starknetPerpsDispatcher.ts
 * @description Starknet On-Chain Dispatcher for PEL Private Perpetuals
 * Encodes and dispatches real Cairo contract transactions via Starknet.js & connected wallets.
 */

import { Call, RpcProvider, uint256 } from 'starknet';

export interface DeploymentConfig {
  network: 'sepolia';
  pelCoreAddress: string;
  strk20AdapterAddress: string;
  oracleAdapterAddress: string;
  stwoVerifierAddress: string;
  collateralTokenAddress: string;
}

export const PERPS_DEPLOYMENTS: Record<'sepolia', DeploymentConfig> = {
  sepolia: {
    network: 'sepolia',
    pelCoreAddress: process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA || '0x658e68d9a311bcdd56d98d3ebbcebff2ddd43463547bab859d4d12092444c2b',
    strk20AdapterAddress: process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA || '0xb0eefeb3c52b062ab63736e93355034058688cbfb8ccba7b7f75261b3f4897',
    oracleAdapterAddress: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA || '0x29e641f5fa56d527a08b22a65bbc27d9cb27694fa983fa150329ade094e1f',
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

  /**
   * Builds ERC20 approve call for collateral token (e.g. TestUSDC)
   * Collateral amounts in cents (1e2) convert to USDC decimals (1e6)
   */
  buildApproveCall(
    spenderAddress: string,
    amountCents: bigint,
    tokenAddress?: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const targetToken = tokenAddress || config.collateralTokenAddress;
    // 1 USD cent = 10_000 micro-USDC (6 decimals)
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
   * Builds the single call to PELPerpsCore.open_position
   */
  buildOpenPositionCall(
    collateralOwner: string,
    marketId: 'BTC-PERP' = 'BTC-PERP',
    commitment: string,
    marginNullifier: string,
    marginAmountUsd: number,
    factHash: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);
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

  /**
   * Builds the call to PELPerpsCore.close_position (with recipient binding)
   */
  buildClosePositionCall(
    recipient: string,
    marketId: 'BTC-PERP' = 'BTC-PERP',
    positionCommitment: string,
    finalNullifier: string,
    payoutNoteCommitment: string,
    payoutAmountUsd: number,
    factHash: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);
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

  /**
   * Builds the call to PELPerpsCore.liquidate_position
   */
  buildLiquidatePositionCall(
    marketId: 'BTC-PERP' = 'BTC-PERP',
    positionCommitment: string,
    positionNullifier: string,
    liquidationFactHash: string,
    keeperRecipient: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    return {
      contractAddress: config.pelCoreAddress,
      entrypoint: 'liquidate_position',
      calldata: [
        marketFelt,
        positionCommitment,
        positionNullifier,
        liquidationFactHash,
        keeperRecipient,
      ],
    };
  }

  /**
   * Builds the call to PELPerpsCore.update_position
   */
  buildUpdatePositionCall(
    marketId: 'BTC-PERP' = 'BTC-PERP',
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    factHash: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    return {
      contractAddress: config.pelCoreAddress,
      entrypoint: 'update_position',
      calldata: [
        marketFelt,
        oldCommitment,
        oldNullifier,
        newCommitment,
        factHash,
      ],
    };
  }

  /**
   * Builds the call to PELPerpsCore.fund_position (7 arguments)
   */
  buildFundPositionCall(
    marketId: 'BTC-PERP' = 'BTC-PERP',
    commitment: string,
    oldNullifier: string,
    newCommitment: string,
    fundingAmountCents: bigint,
    isLongPays: boolean,
    factHash: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = this.marketToFelt(marketId);

    return {
      contractAddress: config.pelCoreAddress,
      entrypoint: 'fund_position',
      calldata: [
        marketFelt,
        commitment,
        oldNullifier,
        newCommitment,
        '0x' + fundingAmountCents.toString(16),
        isLongPays ? '0x1' : '0x0',
        factHash,
      ],
    };
  }

  /**
   * Builds call to STRK20Adapter.claim_payout
   */
  buildClaimPayoutCall(
    payoutNullifier: string,
    recipientNoteCommitment: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'claim_payout',
      calldata: [payoutNullifier, recipientNoteCommitment],
    };
  }

  /**
   * Builds call to STRK20Adapter.deposit_liquidity (LP Counterparty Pool)
   */
  buildDepositLiquidityCall(
    amountCents: bigint,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'deposit_liquidity',
      calldata: ['0x' + amountCents.toString(16)],
    };
  }

  /**
   * Builds call to STRK20Adapter.withdraw_liquidity_shares (Proportional LP Shares)
   */
  buildWithdrawLiquiditySharesCall(
    shares: bigint,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'withdraw_liquidity_shares',
      calldata: ['0x' + shares.toString(16)],
    };
  }

  /**
   * Builds call to STRK20Adapter.claim_keeper_bounty
   */
  buildClaimKeeperBountyCall(
    keeperRecipient: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    return {
      contractAddress: config.strk20AdapterAddress,
      entrypoint: 'claim_keeper_bounty',
      calldata: [keeperRecipient],
    };
  }

  /**
   * Execute real on-chain transaction via connected Starknet browser wallet or server relayer
   */
  async executeOnChain(
    account: any,
    calls: Call | Call[],
    network: 'sepolia' = 'sepolia'
  ): Promise<ExecutionResult> {
    const callArray = Array.isArray(calls) ? calls : [calls];

    if (account && typeof account.execute === 'function') {
      const response = await account.execute(callArray);
      const txHash = response.transaction_hash;
      const explorerUrl = `https://sepolia.voyager.online/tx/${txHash}`;
      await this.provider.waitForTransaction(txHash);
      return {
        transactionHash: txHash,
        explorerUrl,
        status: 'SUCCESS',
      };
    }

    return this.executeViaRelayer(callArray);
  }

  /**
   * Execute transaction via server-side relayer endpoint
   */
  async executeViaRelayer(calls: Call[]): Promise<ExecutionResult> {
    const res = await fetch('/api/relayer/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls }),
    });

    const data = await res.json();
    if (!res.ok || !data.transaction_hash) {
      throw new Error(data.error || 'Server relayer transaction execution failed');
    }

    const txHash = data.transaction_hash;
    const explorerUrl = data.explorerUrl || `https://sepolia.voyager.online/tx/${txHash}`;

    await this.provider.waitForTransaction(txHash);

    return {
      transactionHash: txHash,
      explorerUrl,
      status: 'SUCCESS',
    };
  }

  /**
   * Query on-chain position record verification from PELPerpsCore
   */
  async getPositionOnChain(
    commitment: string,
    network: 'sepolia' = 'sepolia'
  ): Promise<{ exists: boolean; isOpen: boolean; lockedMargin: number; marketId: string }> {
    try {
      const config = PERPS_DEPLOYMENTS[network];
      const res = await this.provider.callContract({
        contractAddress: config.pelCoreAddress,
        entrypoint: 'get_position',
        calldata: [commitment],
      });

      const lockedMargin = parseInt(res[2], 16) / 100;
      const isOpen = res[6] === '0x1' || res[6] === '1';
      return { exists: true, isOpen, lockedMargin, marketId: res[3] };
    } catch {
      return { exists: false, isOpen: false, lockedMargin: 0, marketId: '' };
    }
  }
}

export const starknetPerpsDispatcher = new StarknetPerpsDispatcher();
