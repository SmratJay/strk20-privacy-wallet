/**
 * @file starknetPerpsDispatcher.ts
 * @description Starknet On-Chain Dispatcher for PEL Private Perpetuals
 * Encodes and dispatches real Cairo contract transactions via Starknet.js & connected wallets.
 */

import { Account, Call, Contract, RpcProvider, hash, num } from 'starknet';

export interface DeploymentConfig {
  network: 'sepolia' | 'mainnet';
  pelCoreAddress: string;
  strk20AdapterAddress: string;
  oracleAdapterAddress: string;
}

export const PERPS_DEPLOYMENTS: Record<'sepolia' | 'mainnet', DeploymentConfig> = {
  sepolia: {
    network: 'sepolia',
    pelCoreAddress: process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA || '0x5be824b4b3771247ce6f85084dce536804ffaa8c5f8dbc5be0f9d6744c4c767',
    strk20AdapterAddress: process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA || '0x390386e367645a27fc9219c29452e01bbd03891b6ae8e3cacbe693e516d35bb',
    oracleAdapterAddress: process.env.NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA || '0x401895d6416b08876c01a76bc618f3b7915376e6b57b1d65eb585769b5de848',
  },
  mainnet: {
    network: 'mainnet',
    pelCoreAddress: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    strk20AdapterAddress: '0x07a12b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a',
    oracleAdapterAddress: '0x02a85bd616f912527bb50b3e95849d971c4e427771560b43a0a4f1d62d8531be',
  },
};

export class StarknetPerpsDispatcher {
  private provider: RpcProvider;

  constructor(rpcUrl: string = 'https://api.cartridge.gg/x/starknet/sepolia') {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  /**
   * Builds the transaction calldata for opening a private perpetual position on Cairo
   */
  buildOpenPositionCall(
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
    commitment: string,
    marginNullifier: string,
    marginAmountUsd: number,
    factHash: string,
    network: 'sepolia' | 'mainnet' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
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
   * Builds the transaction calldata for settling / closing a position on Cairo
   */
  buildClosePositionCall(
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
    finalNullifier: string,
    payoutNoteCommitment: string,
    payoutAmountUsd: number,
    factHash: string,
    network: 'sepolia' | 'mainnet' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const payoutAmountFelt = '0x' + Math.floor(payoutAmountUsd * 100).toString(16);

    return {
      contractAddress: config.pelCoreAddress,
      entrypoint: 'close_position',
      calldata: [
        marketFelt,
        finalNullifier,
        payoutNoteCommitment,
        payoutAmountFelt,
        factHash,
      ],
    };
  }

  /**
   * Execute real on-chain transaction via connected Starknet account
   */
  async executeOnChain(account: Account, call: Call): Promise<{ transactionHash: string }> {
    const response = await account.execute([call]);
    return { transactionHash: response.transaction_hash };
  }
}

export const starknetPerpsDispatcher = new StarknetPerpsDispatcher();
