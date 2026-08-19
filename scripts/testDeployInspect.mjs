import { Account, RpcProvider, CallData, json } from 'starknet';
import * as fs from 'fs';

async function testDeploy() {
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

  const execBounds = {
    l2_gas: { max_amount: 30000000n, max_price_per_unit: (l2Price * 12n) / 10n },
    l1_gas: { max_amount: 15n, max_price_per_unit: (l1Price * 12n) / 10n },
    l1_data_gas: { max_amount: 500n, max_price_per_unit: (l1DataPrice * 12n) / 10n },
  };

  const stwoClass = '0x26e286a86abeef1503ba0d7e48c356bdf22d74899d92ed2b6962b7f47c4038b';
  const salt = '0x' + Date.now().toString(16);

  console.log('Deploying test contract...');
  const res = await account.deployContract({
    classHash: stwoClass,
    constructorCalldata: [deployerData.accountAddress],
    salt,
  }, { resourceBounds: execBounds });

  console.log('Keys in deploy result:', Object.keys(res));
  console.log('Full deploy result:', JSON.stringify(res, null, 2));

  const receipt = await provider.waitForTransaction(res.transaction_hash);
  console.log('Receipt events / deployed address:');
  if (receipt.events) {
    for (const ev of receipt.events) {
      console.log('Event:', ev.data);
    }
  }
}

testDeploy().catch(e => console.error('Error:', e.message));
