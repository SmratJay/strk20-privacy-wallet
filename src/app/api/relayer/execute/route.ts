import { NextRequest, NextResponse } from 'next/server';
import { Account, RpcProvider, Call } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { calls } = body;

    if (!calls || !Array.isArray(calls) || calls.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: calls array is required' },
        { status: 400 }
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

    const bounds = {
      l2_gas: { max_amount: 80000000n, max_price_per_unit: 100000000000n },
      l1_gas: { max_amount: 10000n, max_price_per_unit: 300000000000000n },
      l1_data_gas: { max_amount: 5000n, max_price_per_unit: 15000000000000n },
    };

    const res = await account.execute(calls, { resourceBounds: bounds });
    const txHash = res.transaction_hash;
    const explorerUrl = `https://sepolia.voyager.online/tx/${txHash}`;

    return NextResponse.json({
      success: true,
      transaction_hash: txHash,
      explorerUrl,
    });
  } catch (err: any) {
    console.error('Relayer execution error:', err);
    return NextResponse.json(
      { error: err.message || 'Transaction submission failed' },
      { status: 500 }
    );
  }
}
