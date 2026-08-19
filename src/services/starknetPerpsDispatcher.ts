/**
 * @file starknetPerpsDispatcher.ts
 * @description Starknet On-Chain Dispatcher for PEL Private Perpetuals
 * Encodes and dispatches real Cairo contract transactions via Starknet.js & connected wallets.
 */

import { Account, Call, Contract, RpcProvider, hash, num } from 'starknet';

export interface DeploymentConfig {
  network: 'sepolia';
  pelCoreAddress: string;
  strk20AdapterAddress: string;
  oracleAdapterAddress: string;
  stwoVerifierAddress: string;
}

export const PERPS_DEPLOYMENTS: Record<'sepolia', DeploymentConfig> = {
  sepolia: {
    network: 'sepolia',
    pelCoreAddress: process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA || '0x5be824b4b3771247ce6f85084dce536804ffaa8c5f8dbc5be0f9d6744c4c767',
    strk20AdapterAddress: process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA || '0x390386e367645a27fc9219c29452e01bbd03891b6ae8e3cacbe693e516d35bb',
    oracleAdapterAddress: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA || '0x401895d6416b08876c01a76bc618f3b7915376e6b57b1d65eb585769b5de848',
    stwoVerifierAddress: process.env.NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA || '0x57902806d2d74d86e35d7329cda40122f80d4b4d7cdda4997f2412d4ed1067a',
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

  constructor(rpcUrl: string = 'https://api.cartridge.gg/x/starknet/sepolia') {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  private marketToFelt(marketId: string): string {
    return '0x' + Buffer.from(marketId).toString('hex');
  }

  /**
   * Builds the single call to PELPerpsCore.open_position
   * Note: PELPerpsCore atomically calls STRK20Adapter.lock_shielded_margin on-chain!
   */
  buildOpenPositionCall(
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
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
        marketFelt,
        commitment,
        marginNullifier,
        marginAmountFelt,
        factHash,
      ],
    };
  }

  /**
   * Builds the call to PELPerpsCore.close_position
   */
  buildClosePositionCall(
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
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
        factHash,
      ],
    };
  }

  /**
   * Builds the call to PELPerpsCore.liquidate_position
   */
  buildLiquidatePositionCall(
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
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
   * Execute real on-chain transaction via connected Starknet account
   */
  async executeOnChain(
    account: any,
    calls: Call | Call[],
    network: 'sepolia' = 'sepolia'
  ): Promise<ExecutionResult> {
    const callArray = Array.isArray(calls) ? calls : [calls];
    const response = await account.execute(callArray);
    const txHash = response.transaction_hash;
    const explorerUrl = `https://sepolia.voyager.online/tx/${txHash}`;

    // Await real on-chain block receipt
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

      // PositionRecord struct: [commitment, margin_nullifier, locked_margin, market_id, created_at, updated_at, is_active]
      const lockedMargin = parseInt(res[2], 16) / 100;
      const isOpen = res[6] === '0x1' || res[6] === '1';
      return { exists: true, isOpen, lockedMargin, marketId: res[3] };
    } catch {
      return { exists: false, isOpen: false, lockedMargin: 0, marketId: '' };
    }
  }
}

export const starknetPerpsDispatcher = new StarknetPerpsDispatcher();
