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
  console.log('  DEPLOYING HARDENED CONTRACT SUITE TO STARKNET SEPOLIA');
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
        max_amount: isDeclare ? 300000000n : 50000000n,
        max_price_per_unit: (l2GasPrice * 18n) / 10n,
      },
      l1_gas: {
        max_amount: 500n,
        max_price_per_unit: (l1GasPrice * 18n) / 10n,
      },
      l1_data_gas: {
        max_amount: 500n,
        max_price_per_unit: (l1DataGasPrice * 18n) / 10n,
      },
    };
  };

  const loadArtifact = (name) => {
    const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.contract_class.json`);
    const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.compiled_contract_class.json`);
    const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
    const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));
    return {
      name,
      sierra,
      casm,
      sierraClassHash: hash.computeContractClassHash(sierra),
      compiledClassHash: hash.computeCompiledClassHash(casm),
    };
  };

  const stwoArtifact = loadArtifact('StwoVerifier');
  const oracleArtifact = loadArtifact('OracleAdapter');
  const strk20Artifact = loadArtifact('STRK20Adapter');
  const pelCoreArtifact = loadArtifact('PELPerpsCore');

  const declareContract = async (art) => {
    console.log(`\nChecking declaration for ${art.name} (${art.sierraClassHash})...`);
    try {
      const existing = await provider.getClassByHash(art.sierraClassHash);
      if (existing) {
        console.log(`✓ ${art.name} already declared!`);
        return art.sierraClassHash;
      }
    } catch (e) {}

    console.log(`Declaring ${art.name}...`);
    const bounds = await getDynamicBounds(true);
    const res = await account.declare(
      { contract: art.sierra, casm: art.casm, compiledClassHash: art.compiledClassHash },
      { resourceBounds: bounds }
    );
    console.log(`Declare Tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    console.log(`✓ ${art.name} declared!`);
    return art.sierraClassHash;
  };

  const deployContract = async (name, classHash, constructorCalldata) => {
    console.log(`\nDeploying ${name}...`);
    const bounds = await getDynamicBounds(false);
    const res = await account.deployContract(
      { classHash, constructorCalldata },
      { resourceBounds: bounds }
    );
    console.log(`Deploy Tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    const contractAddress = Array.isArray(res.contract_address) ? res.contract_address[0] : res.contract_address;
    console.log(`✓ ${name} Deployed at: \x1b[32m${contractAddress}\x1b[0m`);
    return contractAddress;
  };

  // 1. Declare all classes
  const stwoClassHash = await declareContract(stwoArtifact);
  const oracleClassHash = await declareContract(oracleArtifact);
  const strk20ClassHash = await declareContract(strk20Artifact);
  const pelCoreClassHash = await declareContract(pelCoreArtifact);

  // 2. Deploy StwoVerifier
  const stwoAddress = await deployContract(
    'StwoVerifier',
    stwoClassHash,
    CallData.compile({ admin: deployerData.accountAddress })
  );

  // 3. Deploy OracleAdapter
  const oracleAddress = await deployContract(
    'OracleAdapter',
    oracleClassHash,
    CallData.compile({ admin: deployerData.accountAddress, pragma_oracle: PRAGMA_ORACLE_SEPOLIA })
  );

  // 4. Deploy PELPerpsCore
  const pelCoreAddress = await deployContract(
    'PELPerpsCore',
    pelCoreClassHash,
    CallData.compile({
      admin: deployerData.accountAddress,
      oracle_adapter: oracleAddress,
      strk20_adapter: deployerData.accountAddress,
      stwo_verifier: stwoAddress,
    })
  );

  // 5. Deploy STRK20Adapter
  const strk20Address = await deployContract(
    'STRK20Adapter',
    strk20ClassHash,
    CallData.compile({
      admin: deployerData.accountAddress,
      pel_core: pelCoreAddress,
    })
  );

  // 6. Wire STRK20Adapter into PELPerpsCore
  console.log('\nWiring STRK20Adapter into PELPerpsCore on-chain...');
  const wireBounds = await getDynamicBounds(false);
  const wireRes = await account.execute(
    [
      {
        contractAddress: pelCoreAddress,
        entrypoint: 'set_strk20_adapter',
        calldata: [strk20Address],
      },
    ],
    { resourceBounds: wireBounds }
  );
  console.log(`Wire Tx: ${wireRes.transaction_hash}`);
  await provider.waitForTransaction(wireRes.transaction_hash);
  console.log('✓ PELPerpsCore linked with STRK20Adapter on-chain!');

  // Save Deployed Addresses
  const deployedSummary = {
    network: 'sepolia',
    rpcUrl: SEPOLIA_RPC,
    deployedAt: new Date().toISOString(),
    contracts: {
      PELPerpsCore: pelCoreAddress,
      STRK20Adapter: strk20Address,
      OracleAdapter: oracleAddress,
      StwoVerifier: stwoAddress,
    },
    explorer: {
      PELPerpsCore: `https://sepolia.voyager.online/contract/${pelCoreAddress}`,
      STRK20Adapter: `https://sepolia.voyager.online/contract/${strk20Address}`,
      OracleAdapter: `https://sepolia.voyager.online/contract/${oracleAddress}`,
      StwoVerifier: `https://sepolia.voyager.online/contract/${stwoAddress}`,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deployedSummary, null, 2));

  // Update .env.local
  let envContent = '';
  if (fs.existsSync(ENV_LOCAL_FILE)) {
    envContent = fs.readFileSync(ENV_LOCAL_FILE, 'utf8');
  }

  const envLines = [
    `NEXT_PUBLIC_PEL_CORE_SEPOLIA=${pelCoreAddress}`,
    `NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA=${strk20Address}`,
    `NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA=${oracleAddress}`,
    `NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA=${stwoAddress}`,
  ];

  for (const line of envLines) {
    const key = line.split('=')[0];
    if (envContent.includes(key)) {
      envContent = envContent.replace(new RegExp(`${key}=.*`), line);
    } else {
      envContent += `\n${line}`;
    }
  }

  fs.writeFileSync(ENV_LOCAL_FILE, envContent.trim() + '\n');

  console.log('\n=============================================================');
  console.log('  ALL 4 CAIRO CONTRACTS DEPLOYED & WIRED ON SEPOLIA!');
  console.log('=============================================================');
  console.log(`  PELPerpsCore  : ${pelCoreAddress}`);
  console.log(`  STRK20Adapter : ${strk20Address}`);
  console.log(`  OracleAdapter : ${oracleAddress}`);
  console.log(`  StwoVerifier  : ${stwoAddress}`);
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('Deployment error:', err.message || err);
  process.exit(1);
});
