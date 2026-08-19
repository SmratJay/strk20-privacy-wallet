import { Account, RpcProvider, json, CallData, constants } from 'starknet';
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
  if (!fs.existsSync(DEPLOYER_FILE)) {
    console.error('Missing deployments/deployer_account.json.');
    process.exit(1);
  }

  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  console.log('=============================================================');
  console.log('  STARTING STARKNET SEPOLIA CONTRACT DEPLOYMENT');
  console.log('  Deployer Address: ' + deployerData.accountAddress);
  console.log('  Account Type    : ' + (deployerData.accountType || 'Argent_v0.4.0'));
  console.log('  RPC Endpoint    : ' + SEPOLIA_RPC);
  console.log('=============================================================');

  // Step 1: Check Account Deployment Status
  let isAccountDeployed = false;
  try {
    const classHash = await provider.getClassHashAt(deployerData.accountAddress);
    if (classHash) {
      console.log(`✓ Deployer Account already deployed on-chain (ClassHash: ${classHash})`);
      isAccountDeployed = true;
    }
  } catch (err) {
    console.log('Account not yet deployed on-chain.');
  }

  if (!isAccountDeployed) {
    console.log('Deploying Argent Account to Starknet Sepolia...');
    try {
      const deployAccountPayload = {
        classHash: deployerData.classHash,
        constructorCalldata: deployerData.constructorCalldata || [deployerData.publicKey, '0x0'],
        addressSalt: deployerData.publicKey,
      };

      const { transaction_hash, contract_address } = await account.deployAccount(deployAccountPayload);
      console.log(`Account Deployment Tx: ${transaction_hash}`);
      console.log('Waiting for deployment confirmation...');
      await provider.waitForTransaction(transaction_hash);
      console.log(`✓ Account successfully deployed at: ${contract_address}`);
    } catch (deployErr) {
      console.error('Account deploy error:', deployErr);
      process.exit(1);
    }
  }

  // Step 2: Load Contract Artifacts
  console.log('\n2. Loading Compiled Contract Artifacts from contracts/target/dev/...');
  const loadArtifact = (name) => {
    const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.contract_class.json`);
    const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.compiled_contract_class.json`);
    return {
      sierra: json.parse(fs.readFileSync(sierraPath, 'utf8')),
      casm: json.parse(fs.readFileSync(casmPath, 'utf8')),
    };
  };

  const stwoArtifact = loadArtifact('StwoVerifier');
  const oracleArtifact = loadArtifact('OracleAdapter');
  const strk20Artifact = loadArtifact('STRK20Adapter');
  const pelCoreArtifact = loadArtifact('PELPerpsCore');

  // Step 3: Declare & Deploy StwoVerifier
  console.log('\n3. Declaring & Deploying StwoVerifier...');
  const stwoDecl = await account.declareIfNot({
    contract: stwoArtifact.sierra,
    casm: stwoArtifact.casm,
  });
  if (stwoDecl.transaction_hash) {
    console.log(`   StwoVerifier Declaration Tx: ${stwoDecl.transaction_hash}`);
    await provider.waitForTransaction(stwoDecl.transaction_hash);
  }
  const stwoClassHash = stwoDecl.class_hash;
  console.log(`   StwoVerifier Class Hash: ${stwoClassHash}`);

  const stwoDeploy = await account.deployContract({
    classHash: stwoClassHash,
    constructorCalldata: CallData.compile({ admin: deployerData.accountAddress }),
  });
  console.log(`   StwoVerifier Deployment Tx: ${stwoDeploy.transaction_hash}`);
  await provider.waitForTransaction(stwoDeploy.transaction_hash);
  const stwoAddress = stwoDeploy.contract_address;
  console.log(`   ✓ StwoVerifier Deployed: \x1b[32m${stwoAddress}\x1b[0m`);

  // Step 4: Declare & Deploy OracleAdapter
  console.log('\n4. Declaring & Deploying OracleAdapter...');
  const oracleDecl = await account.declareIfNot({
    contract: oracleArtifact.sierra,
    casm: oracleArtifact.casm,
  });
  if (oracleDecl.transaction_hash) {
    console.log(`   OracleAdapter Declaration Tx: ${oracleDecl.transaction_hash}`);
    await provider.waitForTransaction(oracleDecl.transaction_hash);
  }
  const oracleClassHash = oracleDecl.class_hash;
  console.log(`   OracleAdapter Class Hash: ${oracleClassHash}`);

  const oracleDeploy = await account.deployContract({
    classHash: oracleClassHash,
    constructorCalldata: CallData.compile({
      admin: deployerData.accountAddress,
      pragma_oracle: PRAGMA_ORACLE_SEPOLIA,
    }),
  });
  console.log(`   OracleAdapter Deployment Tx: ${oracleDeploy.transaction_hash}`);
  await provider.waitForTransaction(oracleDeploy.transaction_hash);
  const oracleAddress = oracleDeploy.contract_address;
  console.log(`   ✓ OracleAdapter Deployed: \x1b[32m${oracleAddress}\x1b[0m`);

  // Step 5: Declare & Deploy PELPerpsCore & STRK20Adapter
  console.log('\n5. Declaring & Deploying PELPerpsCore & STRK20Adapter...');
  const strk20Decl = await account.declareIfNot({
    contract: strk20Artifact.sierra,
    casm: strk20Artifact.casm,
  });
  if (strk20Decl.transaction_hash) {
    console.log(`   STRK20Adapter Declaration Tx: ${strk20Decl.transaction_hash}`);
    await provider.waitForTransaction(strk20Decl.transaction_hash);
  }
  const strk20ClassHash = strk20Decl.class_hash;

  const pelCoreDecl = await account.declareIfNot({
    contract: pelCoreArtifact.sierra,
    casm: pelCoreArtifact.casm,
  });
  if (pelCoreDecl.transaction_hash) {
    console.log(`   PELPerpsCore Declaration Tx: ${pelCoreDecl.transaction_hash}`);
    await provider.waitForTransaction(pelCoreDecl.transaction_hash);
  }
  const pelCoreClassHash = pelCoreDecl.class_hash;

  const pelCoreDeploy = await account.deployContract({
    classHash: pelCoreClassHash,
    constructorCalldata: CallData.compile({
      admin: deployerData.accountAddress,
      oracle_adapter: oracleAddress,
      strk20_adapter: deployerData.accountAddress, // Placeholder until STRK20 is deployed
      stwo_verifier: stwoAddress,
    }),
  });
  console.log(`   PELPerpsCore Deployment Tx: ${pelCoreDeploy.transaction_hash}`);
  await provider.waitForTransaction(pelCoreDeploy.transaction_hash);
  const pelCoreAddress = pelCoreDeploy.contract_address;
  console.log(`   ✓ PELPerpsCore Deployed: \x1b[32m${pelCoreAddress}\x1b[0m`);

  const strk20Deploy = await account.deployContract({
    classHash: strk20ClassHash,
    constructorCalldata: CallData.compile({
      admin: deployerData.accountAddress,
      pel_core: pelCoreAddress,
    }),
  });
  console.log(`   STRK20Adapter Deployment Tx: ${strk20Deploy.transaction_hash}`);
  await provider.waitForTransaction(strk20Deploy.transaction_hash);
  const strk20Address = strk20Deploy.contract_address;
  console.log(`   ✓ STRK20Adapter Deployed: \x1b[32m${strk20Address}\x1b[0m`);

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
  console.log('  ALL 4 CAIRO CONTRACTS DEPLOYED & CONFIGURED!');
  console.log('=============================================================');
  console.log(`  PELPerpsCore  : ${pelCoreAddress}`);
  console.log(`  STRK20Adapter : ${strk20Address}`);
  console.log(`  OracleAdapter : ${oracleAddress}`);
  console.log(`  StwoVerifier  : ${stwoAddress}`);
  console.log('  Saved to      : deployments/sepolia_contracts.json (GITIGNORED)');
  console.log('  Updated       : .env.local (GITIGNORED)');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
