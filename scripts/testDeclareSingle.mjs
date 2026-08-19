import { Account, RpcProvider, json, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');

async function testDeclare() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  for (const name of ['StwoVerifier', 'OracleAdapter', 'STRK20Adapter', 'PELPerpsCore']) {
    const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.contract_class.json`);
    const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.compiled_contract_class.json`);
    const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
    const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));
    const classHash = hash.computeSierraContractClassHash(sierra);
    console.log(`\nChecking ${name} (Class Hash: ${classHash})...`);

    try {
      await provider.getClassByHash(classHash);
      console.log(`  ✓ Already declared: ${classHash}`);
    } catch (err) {
      console.log(`  Needs declaration. Declaring...`);
      try {
        const block = await provider.getBlockWithTxs('latest');
        const l2GasPrice = block.l2_gas_price?.price_in_fri ? BigInt(block.l2_gas_price.price_in_fri) : 50000000000n;
        const l1GasPrice = block.l1_gas_price?.price_in_fri ? BigInt(block.l1_gas_price.price_in_fri) : 200000000000000n;
        const l1DataGasPrice = block.l1_data_gas_price?.price_in_fri ? BigInt(block.l1_data_gas_price.price_in_fri) : 5000000000000n;

        const bounds = {
          l2_gas: { max_amount: 800000000n, max_price_per_unit: (l2GasPrice * 20n) / 10n },
          l1_gas: { max_amount: 2000n, max_price_per_unit: (l1GasPrice * 20n) / 10n },
          l1_data_gas: { max_amount: 4000n, max_price_per_unit: (l1DataGasPrice * 20n) / 10n },
        };

        const res = await account.declare({ contract: sierra, casm }, { resourceBounds: bounds });
        console.log(`  Tx: ${res.transaction_hash}`);
        await provider.waitForTransaction(res.transaction_hash);
        console.log(`  ✓ Successfully declared ${name}! Class Hash: ${res.class_hash}`);
      } catch (e) {
        console.error(`  Declare failed:`, e.name, e.message);
        if (e.data) console.error('  Data details:', JSON.stringify(e.data));
      }
    }
  }
}

testDeclare();
