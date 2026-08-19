import { Account, RpcProvider, json, hash, CallData } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const PRAGMA_ORACLE_SEPOLIA = '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');
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

  console.log('--- DEPLOYING HARDENED V2 TO STARKNET SEPOLIA ---');
  console.log('Account:', deployerData.accountAddress);

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
  const oracleClass = '0x501a921124d4b0bb788bc18cb5829db0925c11791c5694829bc88abc25add7';
  const strk20Class = '0x5dc43152295fdbbc884d276c7b638f1865fc9b8c618e5fe748f746c323db6fc';
  const pelCoreClass = '0x164291d1a897e750b482bab2a66e0b1608b58818c88e027b51b381aa25ea086';

  const deployAndGetAddress = async (name, classHash, constructorArgs, salt) => {
    console.log(`\nDeploying ${name}...`);
    const compiledData = CallData.compile(constructorArgs);
    const expectedAddr = hash.calculateContractAddressFromHash(
      salt,
      classHash,
      compiledData,
      deployerData.accountAddress
    );

    const res = await account.deployContract({
      classHash,
      constructorCalldata: compiledData,
      salt,
    }, { resourceBounds: execBounds });

    console.log(`  Tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    const finalAddr = res.contract_address || expectedAddr;
    console.log(`✓ ${name}: ${finalAddr}`);
    return finalAddr;
  };

  const salt1 = '0x' + (Date.now()).toString(16);
  const salt2 = '0x' + (Date.now() + 1).toString(16);
  const salt3 = '0x' + (Date.now() + 2).toString(16);
  const salt4 = '0x' + (Date.now() + 3).toString(16);

  const stwoAddr = await deployAndGetAddress('StwoVerifier', stwoClass, [deployerData.accountAddress], salt1);
  const oracleAddr = await deployAndGetAddress('OracleAdapter', oracleClass, [deployerData.accountAddress, PRAGMA_ORACLE_SEPOLIA], salt2);
  const strk20Addr = await deployAndGetAddress('STRK20Adapter', strk20Class, [deployerData.accountAddress, deployerData.accountAddress], salt3);
  const pelCoreAddr = await deployAndGetAddress('PELPerpsCore', pelCoreClass, [deployerData.accountAddress, strk20Addr, oracleAddr, stwoAddr], salt4);

  console.log('\nAuthorizing PELPerpsCore in STRK20Adapter...');
  const wireTx = await account.execute({
    contractAddress: strk20Addr,
    entrypoint: 'set_pel_core_address',
    calldata: [pelCoreAddr],
  }, { resourceBounds: execBounds });
  await provider.waitForTransaction(wireTx.transaction_hash);
  console.log(`✓ On-chain authorization complete: ${wireTx.transaction_hash}`);

  // Save to JSON & .env.local
  const info = {
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

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(info, null, 2));

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
  console.log('  SUCCESSFULLY DEPLOYED & WIRED HARDENED CONTRACT SUITE!');
  console.log('  PELPerpsCore : ' + pelCoreAddr);
  console.log('  STRK20Adapter: ' + strk20Addr);
  console.log('  OracleAdapter: ' + oracleAddr);
  console.log('  StwoVerifier : ' + stwoAddr);
  console.log('=============================================================');
}

deploy().catch(e => {
  console.error('Fatal deploy error:', e.message || e);
  process.exit(1);
});
