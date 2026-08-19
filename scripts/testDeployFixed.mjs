import { Account, RpcProvider, json } from 'starknet';
import * as fs from 'fs';

async function main() {
  const deployerData = JSON.parse(fs.readFileSync('deployments/deployer_account.json', 'utf8'));
  const provider = new RpcProvider({ nodeUrl: 'https://api.cartridge.gg/x/starknet/sepolia' });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const block = await provider.getBlockWithTxs('latest');
  const l2Price = block.l2_gas_price?.price_in_fri ? BigInt(block.l2_gas_price.price_in_fri) : 40000000000n;
  const l1Price = block.l1_gas_price?.price_in_fri ? BigInt(block.l1_gas_price.price_in_fri) : 200000000000000n;
  const l1DataPrice = block.l1_data_gas_price?.price_in_fri ? BigInt(block.l1_data_gas_price.price_in_fri) : 1000000000000n;

  // Proper bounds: L1DataGas >= 3000
  const bounds = {
    l2_gas: { max_amount: 50000000n, max_price_per_unit: (l2Price * 13n) / 10n },
    l1_gas: { max_amount: 50n, max_price_per_unit: (l1Price * 13n) / 10n },
    l1_data_gas: { max_amount: 4000n, max_price_per_unit: (l1DataPrice * 13n) / 10n },
  };

  const classHash = '0x501a921124d4b0bb788bc18cb5829db0925c11791c5694829bc88abc25add7';
  const pragma = '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21';

  console.log('Deploying OracleAdapter with L1DataGas max 4000...');
  const res = await account.deployContract({
    classHash,
    constructorCalldata: [deployerData.accountAddress, pragma],
  }, { resourceBounds: bounds });

  console.log('Tx Hash:', res.transaction_hash);
  console.log('Contract Address from SDK:', res.contract_address);
  const receipt = await provider.waitForTransaction(res.transaction_hash);
  console.log('Receipt Status:', receipt.execution_status);
  for (const ev of receipt.events) {
    console.log('Event from:', ev.from_address, 'Data:', ev.data);
  }
}

main().catch(e => console.error('Error:', e.message));
