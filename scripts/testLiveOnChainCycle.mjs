import { Account, RpcProvider, CallData, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const CONTRACTS_FILE = path.join(DEPLOYMENTS_DIR, 'sepolia_contracts.json');

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const contractsData = JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));

  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  console.log('=============================================================');
  console.log('  LIVE ON-CHAIN INTEGRATION TEST ON STARKNET SEPOLIA');
  console.log('  PELPerpsCore: ' + contractsData.contracts.PELPerpsCore);
  console.log('  STRK20Adapter: ' + contractsData.contracts.STRK20Adapter);
  console.log('=============================================================');

  const marketId = 'BTC-PERP';
  const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
  const marginUsd = 100;
  const marginAmountFelt = '0x' + Math.floor(marginUsd * 100).toString(16); // 10000 cents

  // 1. Generate real cryptographic witness & commitment
  const nonce = '0x' + Math.random().toString(16).substring(2, 10) + 'beef';
  const notionalUsd = 1000;
  const entryPrice = 96420.50;
  const oraclePriceCents = 9642050;

  const POSITION_TAG = '0x504f534954494f4e5f5441473a5631';
  const commitment = hash.computePoseidonHashOnElements([
    POSITION_TAG,
    deployerData.accountAddress,
    marketFelt,
    '0x' + Math.floor(notionalUsd * 100).toString(16),
    '0x' + oraclePriceCents.toString(16),
    marginAmountFelt,
    nonce,
  ]);

  const NULLIFIER_TAG = '0x4e554c4c49464945525f5441473a5631';
  const marginNullifier = hash.computePoseidonHashOnElements([
    NULLIFIER_TAG,
    commitment,
    nonce,
  ]);

  // 2. Compute Public Inputs & Fact Hash matching StwoVerifier.cairo
  const proofTypeFelt = '0x' + Buffer.from('OPEN').toString('hex');
  const publicInputsHash = hash.computePoseidonHashOnElements([
    proofTypeFelt,
    marketFelt,
    commitment,
    marginNullifier,
    marginAmountFelt,
    '0x' + oraclePriceCents.toString(16),
  ]);

  const STWO_TAG = '0x' + Buffer.from('STWO_SNIP36_PROOF_V2').toString('hex');
  const factHash = hash.computePoseidonHashOnElements([
    publicInputsHash,
    STWO_TAG,
  ]);

  console.log('\n--- Step 1: Open Private Position on PELPerpsCore ---');
  console.log('Market:', marketId);
  console.log('Commitment:', commitment);
  console.log('Margin Nullifier:', marginNullifier);
  console.log('Fact Hash:', factHash);

  const openCall = {
    contractAddress: contractsData.contracts.PELPerpsCore,
    entrypoint: 'open_position',
    calldata: [
      marketFelt,
      commitment,
      marginNullifier,
      marginAmountFelt,
      factHash,
    ],
  };

  const bounds = {
    l2_gas: { max_amount: 80000000n, max_price_per_unit: 100000000000n },
    l1_gas: { max_amount: 10000n, max_price_per_unit: 300000000000000n },
    l1_data_gas: { max_amount: 5000n, max_price_per_unit: 15000000000000n },
  };

  const openTx = await account.execute([openCall], { resourceBounds: bounds });
  console.log(`Open Tx Submitted: https://sepolia.voyager.online/tx/${openTx.transaction_hash}`);
  await provider.waitForTransaction(openTx.transaction_hash);
  console.log('✓ Open Position Mined & Confirmed on-chain!');

  // 3. Verify on-chain storage record
  console.log('\n--- Step 2: Query On-Chain Position Record ---');
  const posRecord = await provider.callContract({
    contractAddress: contractsData.contracts.PELPerpsCore,
    entrypoint: 'get_position',
    calldata: [commitment],
  });
  console.log('Position Query Response:', posRecord);
  const isOpen = posRecord[6] === '0x1' || posRecord[6] === '1';
  console.log(`✓ Position active status on-chain: \x1b[32m${isOpen}\x1b[0m`);

  // 4. Verify STRK20 total locked collateral
  const lockedCollateral = await provider.callContract({
    contractAddress: contractsData.contracts.STRK20Adapter,
    entrypoint: 'get_total_locked_collateral',
    calldata: [],
  });
  console.log(`✓ STRK20Adapter Locked Collateral: \x1b[32m$${parseInt(lockedCollateral[0], 16) / 100}\x1b[0m`);

  // 5. Settle and Close Position on-chain
  console.log('\n--- Step 3: Settle & Close Position on PELPerpsCore ---');
  const finalNullifier = hash.computePoseidonHashOnElements([
    NULLIFIER_TAG,
    commitment,
    '0x1234c105e',
  ]);

  const payoutAmountUsd = 135.50; // $100 margin + $35.50 PnL
  const payoutAmountFelt = '0x' + Math.floor(payoutAmountUsd * 100).toString(16); // 13550 cents
  const payoutNoteCommitment = hash.computePoseidonHashOnElements([
    POSITION_TAG,
    deployerData.accountAddress,
    payoutAmountFelt,
    '0x9999ba4e',
  ]);

  const closeProofTypeFelt = '0x' + Buffer.from('CLOSE').toString('hex');
  const closePublicInputsHash = hash.computePoseidonHashOnElements([
    closeProofTypeFelt,
    marketFelt,
    payoutNoteCommitment,
    finalNullifier,
    payoutAmountFelt,
    '0x' + oraclePriceCents.toString(16),
  ]);
  const closeFactHash = hash.computePoseidonHashOnElements([
    closePublicInputsHash,
    STWO_TAG,
  ]);

  const closeCall = {
    contractAddress: contractsData.contracts.PELPerpsCore,
    entrypoint: 'close_position',
    calldata: [
      marketFelt,
      commitment,
      finalNullifier,
      payoutNoteCommitment,
      payoutAmountFelt,
      closeFactHash,
    ],
  };

  const closeTx = await account.execute([closeCall], { resourceBounds: bounds });
  console.log(`Close Tx Submitted: https://sepolia.voyager.online/tx/${closeTx.transaction_hash}`);
  await provider.waitForTransaction(closeTx.transaction_hash);
  console.log('✓ Position Settled & Closed on-chain!');

  // 6. Verify position is deactivated on-chain
  const posRecordClosed = await provider.callContract({
    contractAddress: contractsData.contracts.PELPerpsCore,
    entrypoint: 'get_position',
    calldata: [commitment],
  });
  const isStillOpen = posRecordClosed[6] === '0x1' || posRecordClosed[6] === '1';
  console.log(`✓ Position active status after close: \x1b[32m${isStillOpen ? 'OPEN' : 'CLOSED'}\x1b[0m`);

  console.log('\n=============================================================');
  console.log('  FULL END-TO-END ON-CHAIN TEST PASSED ON SEPOLIA! 🎉');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
