/**
 * @file route.ts
 * @description Secure Gasless Relayer Endpoint for PEL Private Perpetuals
 * Enforces strict destination contract and selector allowlists to prevent server account draining.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Account, RpcProvider, Call } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { validateRelayerCalls } from '@/services/relayerSecurity';

const SEPOLIA_RPC = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const calls: Call[] = body.calls;

    // Strict Security & Whitelist validation
    const validation = validateRelayerCalls(calls);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 403 }
      );
    }

    // Retrieve private key securely from server environment or deployment file
    let deployerAddress = process.env.DEPLOYER_ACCOUNT_ADDRESS;
    let deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

    if (!deployerAddress || !deployerPrivateKey) {
      const deployerFilePath = path.join(process.cwd(), 'deployments/deployer_account.json');
      if (fs.existsSync(deployerFilePath)) {
        const data = JSON.parse(fs.readFileSync(deployerFilePath, 'utf8'));
        deployerAddress = data.accountAddress;
        deployerPrivateKey = data.privateKey;
      }
    }

    if (!deployerAddress || !deployerPrivateKey) {
      return NextResponse.json(
        { error: 'Server relayer credentials not configured' },
        { status: 500 }
      );
    }

    const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
    const account = new Account({
      provider,
      address: deployerAddress,
      signer: deployerPrivateKey,
    });

    // Dynamic gas bounds query
    let l1GasPrice = 200000000000000n;
    let l2GasPrice = 40000000000n;
    let l1DataGasPrice = 1000000000000n;

    try {
      const block = await provider.getBlockWithTxs('latest');
      if (block.l1_gas_price?.price_in_fri) l1GasPrice = BigInt(block.l1_gas_price.price_in_fri);
      if (block.l2_gas_price?.price_in_fri) l2GasPrice = BigInt(block.l2_gas_price.price_in_fri);
      if (block.l1_data_gas_price?.price_in_fri) l1DataGasPrice = BigInt(block.l1_data_gas_price.price_in_fri);
    } catch (e) {}

    const bounds = {
      l2_gas: { max_amount: 25000000n, max_price_per_unit: (l2GasPrice * 12n) / 10n },
      l1_gas: { max_amount: 15n, max_price_per_unit: (l1GasPrice * 12n) / 10n },
      l1_data_gas: { max_amount: 3000n, max_price_per_unit: (l1DataGasPrice * 12n) / 10n },
    };

    const res = await account.execute(calls, { resourceBounds: bounds });
    const txHash = res.transaction_hash;
    const explorerUrl = `https://sepolia.voyager.online/tx/${txHash}`;

    return NextResponse.json({
      success: true,
      transaction_hash: txHash,
      explorerUrl,
    });
  } catch (error: any) {
    console.error('Relayer execution failed:', error);
    return NextResponse.json(
      { error: error?.message || 'Transaction execution failed in relayer' },
      { status: 500 }
    );
  }
}
