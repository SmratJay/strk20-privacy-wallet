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

async function main() {
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

  const getDynamicBounds = async (isDeclare = false) => {
    let l1GasPrice = 200000000000000n;
    let l2GasPrice = 50000000000n;
    let l1DataGasPrice = 5000000000000n;

    try {
      const block = await provider.getBlockWithTxs('latest');
      if (block.l1_gas_price?.price_in_fri) l1GasPrice = BigInt(block.l1_gas_price.price_in_fri);
      if (block.l2_gas_price?.price_in_fri) l2GasPrice = BigInt(block.l2_gas_price.price_in_fri);
      if (block.l1_data_gas_price?.price_in_fri) l1DataGasPrice = BigInt(block.l1_data_gas_price.price_in_fri);
    } catch (e) {}

    return {
      l2_gas: {
        max_amount: isDeclare ? 60000000n : 30000000n,
        max_price_per_unit: (l2GasPrice * 12n) / 10n,
      },
      l1_gas: {
        max_amount: isDeclare ? 30n : 15n,
        max_price_per_unit: (l1GasPrice * 12n) / 10n,
      },
      l1_data_gas: {
        max_amount: isDeclare ? 1000n : 400n,
        max_price_per_unit: (l1DataGasPrice * 12n) / 10n,
      },
    };
  };

  const loadArtifact = (name) => {
    const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.contract_class.json`);
    const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.compiled_contract_class.json`);
    const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
    const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));
    return { sierra, casm };
  };

  const declareIfNotDeclared = async (name) => {
    const { sierra, casm } = loadArtifact(name);
    const computedClassHash = hash.computeSierraContractClassHash(sierra);
    console.log(`\n[${name}] Computed Class Hash: ${computedClassHash}`);

    try {
      await provider.getClassByHash(computedClassHash);
      console.log(`  ✓ Class ${name} already declared on Sepolia.`);
      return computedClassHash;
    } catch (err) {
      console.log(`  Declaring class ${name} on Sepolia...`);
      try {
        const declareBounds = await getDynamicBounds(true);
        const declareRes = await account.declare(
          { contract: sierra, casm },
          { resourceBounds: declareBounds }
        );
        console.log(`  Declare Tx: ${declareRes.transaction_hash}`);
        await provider.waitForTransaction(declareRes.transaction_hash);
        console.log(`  ✓ Successfully declared ${name}! Class Hash: ${declareRes.class_hash}`);
        return declareRes.class_hash;
      } catch (declErr) {
        console.error(`  Declare failed for ${name}:`, declErr.message || declErr);
        throw new Error(`Failed to declare ${name}: ${declErr.message || declErr}`);
      }
    }
  };

  // 1. Declare all 4 contracts
  const stwoClassHash = await declareIfNotDeclared('StwoVerifier');
  const oracleClassHash = await declareIfNotDeclared('OracleAdapter');
  const strk20ClassHash = await declareIfNotDeclared('STRK20Adapter');
  const pelCoreClassHash = await declareIfNotDeclared('PELPerpsCore');

  const salt = '0x' + Date.now().toString(16);

  // 2. Deploy StwoVerifier
  console.log('\nDeploying StwoVerifier instance...');
  const stwoBounds = await getDynamicBounds(false);
  const stwoRes = await account.deployContract(
    {
      classHash: stwoClassHash,
      constructorCalldata: CallData.compile([deployerData.accountAddress]),
      salt,
    },
    { resourceBounds: stwoBounds }
  );
  await provider.waitForTransaction(stwoRes.transaction_hash);
  const stwoAddress = stwoRes.contract_address;
  console.log(`  ✓ StwoVerifier deployed at: ${stwoAddress}`);

  // 3. Deploy OracleAdapter
  console.log('\nDeploying OracleAdapter instance...');
  const oracleBounds = await getDynamicBounds(false);
  const oracleRes = await account.deployContract(
    {
      classHash: oracleClassHash,
      constructorCalldata: CallData.compile([deployerData.accountAddress, PRAGMA_ORACLE_SEPOLIA]),
      salt,
    },
    { resourceBounds: oracleBounds }
  );
  await provider.waitForTransaction(oracleRes.transaction_hash);
  const oracleAddress = oracleRes.contract_address;
  console.log(`  ✓ OracleAdapter deployed at: ${oracleAddress}`);

  // 4. Deploy STRK20Adapter (with placeholder pel_core address = deployer initially)
  console.log('\nDeploying STRK20Adapter instance with Insurance Fund & Note Registry...');
  const strk20Bounds = await getDynamicBounds(false);
  const strk20Res = await account.deployContract(
    {
      classHash: strk20ClassHash,
      constructorCalldata: CallData.compile([deployerData.accountAddress, deployerData.accountAddress]),
      salt,
    },
    { resourceBounds: strk20Bounds }
  );
  await provider.waitForTransaction(strk20Res.transaction_hash);
  const strk20Address = strk20Res.contract_address;
  console.log(`  ✓ STRK20Adapter deployed at: ${strk20Address}`);

  // 5. Deploy PELPerpsCore
  console.log('\nDeploying PELPerpsCore instance...');
  const pelBounds = await getDynamicBounds(false);
  const pelRes = await account.deployContract(
    {
      classHash: pelCoreClassHash,
      constructorCalldata: CallData.compile([
        deployerData.accountAddress,
        strk20Address,
        oracleAddress,
        stwoAddress,
      ]),
      salt,
    },
    { resourceBounds: pelBounds }
  );
  await provider.waitForTransaction(pelRes.transaction_hash);
  const pelCoreAddress = pelRes.contract_address;
  console.log(`  ✓ PELPerpsCore deployed at: ${pelCoreAddress}`);

  // 6. Wire STRK20Adapter to PELPerpsCore
  console.log('\nWiring STRK20Adapter to PELPerpsCore on-chain...');
  const wireBounds = await getDynamicBounds(false);
  const wireTx = await account.execute(
    {
      contractAddress: strk20Address,
      entrypoint: 'set_pel_core_address',
      calldata: [pelCoreAddress],
    },
    { resourceBounds: wireBounds }
  );
  console.log(`  Wiring Tx: ${wireTx.transaction_hash}`);
  await provider.waitForTransaction(wireTx.transaction_hash);
  console.log(`  ✓ STRK20Adapter authorized PELPerpsCore on-chain!`);

  // 7. Save to deployments/sepolia_contracts.json and .env.local
  const deploymentInfo = {
    network: 'starknet-sepolia',
    timestamp: new Date().toISOString(),
    deployer: deployerData.accountAddress,
    classes: {
      StwoVerifier: stwoClassHash,
      OracleAdapter: oracleClassHash,
      STRK20Adapter: strk20ClassHash,
      PELPerpsCore: pelCoreClassHash,
    },
    contracts: {
      PELPerpsCore: pelCoreAddress,
      STRK20Adapter: strk20Address,
      OracleAdapter: oracleAddress,
      StwoVerifier: stwoAddress,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n✓ Saved deployment addresses to: ${OUTPUT_FILE}`);

  let envContent = fs.existsSync(ENV_LOCAL_FILE) ? fs.readFileSync(ENV_LOCAL_FILE, 'utf8') : '';
  const updateEnv = (key, val) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }
  };

  updateEnv('NEXT_PUBLIC_PEL_CORE_SEPOLIA', pelCoreAddress);
  updateEnv('NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA', strk20Address);
  updateEnv('NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA', oracleAddress);
  updateEnv('NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA', stwoAddress);

  fs.writeFileSync(ENV_LOCAL_FILE, envContent.trim() + '\n');
  console.log(`✓ Updated .env.local with live contracts`);
}

main().catch((err) => {
  console.error('Deployment failed:', err.message || err);
  if (err.data) console.error('Error data:', err.data);
  process.exit(1);
});
