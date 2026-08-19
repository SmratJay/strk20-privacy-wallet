import { Account, RpcProvider, json, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYER_FILE = path.join(process.cwd(), 'deployments/deployer_account.json');
const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');

async function testDeclare() {
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_StwoVerifier.contract_class.json`);
  const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_StwoVerifier.compiled_contract_class.json`);

  const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
  const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));

  const compiledClassHash = hash.computeCompiledClassHash(casm);
  const sierraClassHash = hash.computeContractClassHash(sierra);

  console.log(`Sierra Class Hash   : ${sierraClassHash}`);
  console.log(`Compiled Class Hash : ${compiledClassHash}`);

  try {
    const decl = await account.declareIfNot({
      contract: sierra,
      casm: casm,
      compiledClassHash: compiledClassHash,
    });
    console.log('Declaration result:', decl);
  } catch (e) {
    console.error('Declaration error:', e);
  }
}

testDeclare();
