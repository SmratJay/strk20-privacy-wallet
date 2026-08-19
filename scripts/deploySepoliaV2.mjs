import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const PRAGMA_ORACLE_SEPOLIA = '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'sepolia_contracts.json');
const ENV_LOCAL_FILE = path.join(process.cwd(), '.env.local');

async function deploy() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  console.log('=============================================================');
  console.log('  DEPLOYING HARDENED V2 CONTRACT SUITE TO STARKNET SEPOLIA');
  console.log('  Deployer: ' + deployerData.accountAddress);
  console.log('=============================================================');

  const block = await provider.getBlockWithTxs('latest');
  const l2Price = block.l2_gas_price?.price_in_fri ? BigInt(block.l2_gas_price.price_in_fri) : 40000000000n;
  const l1Price = block.l1_gas_price?.price_in_fri ? BigInt(block.l1_gas_price.price_in_fri) : 200000000000000n;
  const l1DataPrice = block.l1_data_gas_price?.price_in_fri ? BigInt(block.l1_data_gas_price.price_in_fri) : 1000000000000n;

  const execBounds = {
    l2_gas: { max_amount: 50000000n, max_price_per_unit: (l2Price * 13n) / 10n },
    l1_gas: { max_amount: 50n, max_price_per_unit: (l1Price * 13n) / 10n },
    l1_data_gas: { max_amount: 4000n, max_price_per_unit: (l1DataPrice * 13n) / 10n },
  };

  const stwoClass = '0x26e286a86abeef1503ba0d7e48c356bdf22d74899d92ed2b6962b7f47c4038b';
  const oracleClass = '0x501a921124d4b0bb788bc18cb5829db0925c11791c5694829bc88abc25add7';
  const strk20Class = '0x5dc43152295fdbbc884d276c7b638f1865fc9b8c618e5fe748f746c323db6fc';
  const pelCoreClass = '0x164291d1a897e750b482bab2a66e0b1608b58818c88e027b51b381aa25ea086';

  const deployContractInstance = async (name, classHash, constructorCalldata) => {
    console.log(`\nDeploying ${name}...`);
    const salt = '0x' + (Date.now() + Math.floor(Math.random() * 100000)).toString(16);
    const res = await account.deployContract({
      classHash,
      constructorCalldata,
      salt,
    }, { resourceBounds: execBounds });

    console.log(`  Tx Hash: ${res.transaction_hash}`);
    const receipt = await provider.waitForTransaction(res.transaction_hash);

    if (receipt.execution_status === 'REVERTED') {
      throw new Error(`Deployment of ${name} reverted: ${receipt.revert_reason}`);
    }

    let contractAddress = res.contract_address || res.address;
    if (!contractAddress && receipt.events) {
      for (const ev of receipt.events) {
        if (ev.from_address === '0x041a78e741e5af2fec34b695679bc6891742439f7afb84150e139fa83e4b970' || ev.data?.length >= 6) {
          contractAddress = ev.data[0];
          break;
        }
      }
    }

    if (!contractAddress) {
      throw new Error(`Failed to extract contract address for ${name}`);
    }

    console.log(`✓ ${name} deployed at: ${contractAddress}`);
    return contractAddress;
  };

  // 1. Deploy StwoVerifier
  const stwoAddr = await deployContractInstance('StwoVerifier', stwoClass, [deployerData.accountAddress]);

  // 2. Deploy OracleAdapter
  const oracleAddr = await deployContractInstance('OracleAdapter', oracleClass, [deployerData.accountAddress, PRAGMA_ORACLE_SEPOLIA]);

  // 3. Deploy STRK20Adapter (with placeholder admin as pel_core)
  const strk20Addr = await deployContractInstance('STRK20Adapter', strk20Class, [deployerData.accountAddress, deployerData.accountAddress]);

  // 4. Deploy PELPerpsCore (Constructor order: admin, oracle_adapter, strk20_adapter, stwo_verifier)
  const pelCoreAddr = await deployContractInstance('PELPerpsCore', pelCoreClass, [
    deployerData.accountAddress,
    oracleAddr,
    strk20Addr,
    stwoAddr,
  ]);

  // 5. Wire STRK20Adapter to authorize PELPerpsCore
  console.log('\nAuthorizing PELPerpsCore in STRK20Adapter on-chain...');
  const wireTx = await account.execute({
    contractAddress: strk20Addr,
    entrypoint: 'set_pel_core_address',
    calldata: [pelCoreAddr],
  }, { resourceBounds: execBounds });

  console.log(`  Wiring Tx Hash: ${wireTx.transaction_hash}`);
  const wireReceipt = await provider.waitForTransaction(wireTx.transaction_hash);
  if (wireReceipt.execution_status === 'REVERTED') {
    throw new Error(`Wiring reverted: ${wireReceipt.revert_reason}`);
  }
  console.log(`✓ STRK20Adapter successfully authorized PELPerpsCore on-chain!`);

  // 6. Save deployments
  const deploymentInfo = {
    network: 'starknet-sepolia',
    timestamp: new Date().toISOString(),
    deployer: deployerData.accountAddress,
    classes: {
      StwoVerifier: stwoClass,
      OracleAdapter: oracleClass,
      STRK20Adapter: strk20Class,
      PELPerpsCore: pelCoreClass,
    },
    contracts: {
      PELPerpsCore: pelCoreAddr,
      STRK20Adapter: strk20Addr,
      OracleAdapter: oracleAddr,
      StwoVerifier: stwoAddr,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n✓ Saved deployment addresses to: ${OUTPUT_FILE}`);

  let env = fs.existsSync(ENV_LOCAL_FILE) ? fs.readFileSync(ENV_LOCAL_FILE, 'utf8') : '';
  const updateEnv = (k, v) => {
    const r = new RegExp(`^${k}=.*$`, 'm');
    env = r.test(env) ? env.replace(r, `${k}=${v}`) : `${env}\n${k}=${v}`;
  };
  updateEnv('NEXT_PUBLIC_PEL_CORE_SEPOLIA', pelCoreAddr);
  updateEnv('NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA', strk20Addr);
  updateEnv('NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA', oracleAddr);
  updateEnv('NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA', stwoAddr);
  fs.writeFileSync(ENV_LOCAL_FILE, env.trim() + '\n');

  console.log('\n=============================================================');
  console.log('  LIVE DEPLOYMENT COMPLETE ON STARKNET SEPOLIA!');
  console.log('  PELPerpsCore : ' + pelCoreAddr);
  console.log('  STRK20Adapter: ' + strk20Addr);
  console.log('  OracleAdapter: ' + oracleAddr);
  console.log('  StwoVerifier : ' + stwoAddr);
  console.log('=============================================================');
}

deploy().catch(e => {
  console.error('Deployment failed:', e.message || e);
  process.exit(1);
});
