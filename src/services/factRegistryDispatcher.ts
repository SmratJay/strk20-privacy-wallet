/**
 * @file factRegistryDispatcher.ts
 * @description Dispatcher for registering and querying self-describing verified facts on the on-chain FactRegistry
 */

import { Call, RpcProvider } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';

export class FactRegistryDispatcher {
  private provider: RpcProvider;

  constructor(rpcUrl: string = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia') {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  buildRegisterFactCall(
    proofType: 'OPEN' | 'UPDATE' | 'FUND' | 'LIQUIDATE' | 'CLOSE' | string,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
    recipientOrCaller: string,
    factHash: string,
    network: 'sepolia' = 'sepolia'
  ): Call {
    const config = PERPS_DEPLOYMENTS[network];
    const proofTypeFelt = '0x' + Buffer.from(proofType).toString('hex');
    const marketIdFelt = '0x' + Buffer.from(marketId).toString('hex');

    return {
      contractAddress: config.stwoVerifierAddress,
      entrypoint: 'register_verified_fact',
      calldata: [
        proofTypeFelt,
        marketIdFelt,
        commitment,
        nullifier,
        '0x' + amountCents.toString(16),
        '0x' + oraclePriceCents.toString(16),
        recipientOrCaller || '0x0',
        factHash,
      ],
    };
  }

  async isFactRegistered(factHash: string, network: 'sepolia' = 'sepolia'): Promise<boolean> {
    try {
      const config = PERPS_DEPLOYMENTS[network];
      const res = await this.provider.callContract({
        contractAddress: config.stwoVerifierAddress,
        entrypoint: 'is_fact_registered',
        calldata: [factHash],
      });
      return res[0] === '0x1' || res[0] === '1';
    } catch {
      return false;
    }
  }
}

export const factRegistryDispatcher = new FactRegistryDispatcher();
