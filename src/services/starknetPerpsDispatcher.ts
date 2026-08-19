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
    pelCoreAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    strk20AdapterAddress: '0x01243b3f2e1a3b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
    oracleAdapterAddress: '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21',
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

  constructor(rpcUrl: string = 'https://starknet-sepolia.public.blastapi.io/rpc/v0_7') {
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
