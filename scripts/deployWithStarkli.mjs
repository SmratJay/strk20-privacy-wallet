import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const STARKLI_BIN = '/Users/jaybhati/.starkli/bin/starkli';
const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const PRAGMA_ORACLE_SEPOLIA = '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const STARKLI_ACCOUNT = path.join(DEPLOYMENTS_DIR, 'starkli_account.json');
const STARKLI_KEYSTORE = path.join(DEPLOYMENTS_DIR, 'starkli_keystore.json');
const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'sepolia_contracts.json');
const ENV_LOCAL_FILE = path.join(process.cwd(), '.env.local');

const KEYSTORE_PASSWORD = 'perps_deployer_secure_pwd_2026';

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

  console.log('=============================================================');
  console.log('  DEPLOYING CAIRO CONTRACTS VIA STARKLI 0.4.2');
  console.log('  Deployer Address: ' + deployerData.accountAddress);
  console.log('=============================================================');

  // Step 1: Create Keystore if not exists
  if (!fs.existsSync(STARKLI_KEYSTORE)) {
    console.log('Creating Starkli keystore...');
    const cmd = `echo "${deployerData.privateKey}" | ${STARKLI_BIN} signer keystore from-key ${STARKLI_KEYSTORE} --private-key-stdin --password ${KEYSTORE_PASSWORD}`;
    execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
    console.log('✓ Keystore created at:', STARKLI_KEYSTORE);
  }

  const runStarkli = (args) => {
    const fullCmd = `${STARKLI_BIN} ${args} --account ${STARKLI_ACCOUNT} --keystore ${STARKLI_KEYSTORE} --keystore-password ${KEYSTORE_PASSWORD} --rpc ${SEPOLIA_RPC}`;
    console.log(`\n> starkli ${args.split(' ')[0]} ...`);
    const output = execSync(fullCmd, { encoding: 'utf8' });
    console.log(output.trim());
    return output.trim();
  };

  // 1. StwoVerifier
  console.log('\n--- 1. Declaring and Deploying StwoVerifier ---');
  const stwoSierra = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_StwoVerifier.contract_class.json');
  const stwoCasml = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_StwoVerifier.compiled_contract_class.json');
  
  let stwoClassHash;
  try {
    const declOut = runStarkli(`declare ${stwoSierra} --casm-file ${stwoCasml} --watch`);
    stwoClassHash = declOut.match(/0x[0-9a-fA-F]+/)?.[0] || declOut.split('\n').pop().trim();
  } catch (err) {
    if (err.message.includes('already declared')) {
      const match = err.message.match(/0x[0-9a-fA-F]+/);
      stwoClassHash = match ? match[0] : '';
    } else {
      console.log('Declaration note:', err.message);
    }
  }

  const stwoDeployOut = runStarkli(`deploy ${stwoSierra} ${deployerData.accountAddress} --watch`);
  const stwoAddress = stwoDeployOut.match(/0x[0-9a-fA-F]+/)?.[0] || stwoDeployOut.split('\n').pop().trim();
  console.log(`✓ StwoVerifier Deployed: ${stwoAddress}`);

  // 2. OracleAdapter
  console.log('\n--- 2. Declaring and Deploying OracleAdapter ---');
  const oracleSierra = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_OracleAdapter.contract_class.json');
  const oracleCasml = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_OracleAdapter.compiled_contract_class.json');
  
  try {
    runStarkli(`declare ${oracleSierra} --casm-file ${oracleCasml} --watch`);
  } catch (err) {
    console.log('OracleAdapter declaration note:', err.message);
  }

  const oracleDeployOut = runStarkli(`deploy ${oracleSierra} ${deployerData.accountAddress} ${PRAGMA_ORACLE_SEPOLIA} --watch`);
  const oracleAddress = oracleDeployOut.match(/0x[0-9a-fA-F]+/)?.[0] || oracleDeployOut.split('\n').pop().trim();
  console.log(`✓ OracleAdapter Deployed: ${oracleAddress}`);

  // 3. PELPerpsCore
  console.log('\n--- 3. Declaring and Deploying PELPerpsCore ---');
  const pelCoreSierra = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_PELPerpsCore.contract_class.json');
  const pelCoreCasml = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_PELPerpsCore.compiled_contract_class.json');

  try {
    runStarkli(`declare ${pelCoreSierra} --casm-file ${pelCoreCasml} --watch`);
  } catch (err) {
    console.log('PELPerpsCore declaration note:', err.message);
  }

  const pelCoreDeployOut = runStarkli(`deploy ${pelCoreSierra} ${deployerData.accountAddress} ${oracleAddress} ${deployerData.accountAddress} ${stwoAddress} --watch`);
  const pelCoreAddress = pelCoreDeployOut.match(/0x[0-9a-fA-F]+/)?.[0] || pelCoreDeployOut.split('\n').pop().trim();
  console.log(`✓ PELPerpsCore Deployed: ${pelCoreAddress}`);

  // 4. STRK20Adapter
  console.log('\n--- 4. Declaring and Deploying STRK20Adapter ---');
  const strk20Sierra = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_STRK20Adapter.contract_class.json');
  const strk20Casml = path.join(TARGET_DEV_DIR, 'pel_perpetuals_core_STRK20Adapter.compiled_contract_class.json');

  try {
    runStarkli(`declare ${strk20Sierra} --casm-file ${strk20Casml} --watch`);
  } catch (err) {
    console.log('STRK20Adapter declaration note:', err.message);
  }

  const strk20DeployOut = runStarkli(`deploy ${strk20Sierra} ${deployerData.accountAddress} ${pelCoreAddress} --watch`);
  const strk20Address = strk20DeployOut.match(/0x[0-9a-fA-F]+/)?.[0] || strk20DeployOut.split('\n').pop().trim();
  console.log(`✓ STRK20Adapter Deployed: ${strk20Address}`);

  // Summary and file writing
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
  console.log('  Saved to      : deployments/sepolia_contracts.json');
  console.log('  Updated       : .env.local');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('Deployment error:', err.message);
  process.exit(1);
});
