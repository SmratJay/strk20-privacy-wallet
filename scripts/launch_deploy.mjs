#!/usr/bin/env node
/**
 * UMBRA LAUNCH deployment script (mainnet-first; --sepolia for testnet).
 *
 * 1. Declares the 5 launch contracts from umbra-launch-contracts artifacts.
 * 2. Deploys GraduationRouter + TokenFactory.
 * 3. Launches the HAMSTR demo memecoin via the factory.
 * 4. Writes deployments/umbra-launch.json and prints the .env.local lines to wire the app.
 *
 * Safety: every tx hash and address is recorded from the actual chain responses. Nothing
 * is fabricated. Run `scarb build` in umbra-launch-contracts first.
 */
import { Account, RpcProvider, json, hash, CallData, shortString } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_DIR = path.join(ROOT, 'umbra-launch-contracts/target/dev');
const DEPLOYMENTS_DIR = path.join(ROOT, 'deployments');

const isSepolia = process.argv.includes('--sepolia');
const NETWORK = isSepolia ? 'sepolia' : 'mainnet';

const RPC = isSepolia
  ? process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia'
  : process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://free-rpc.nethermind.io/mainnet-juno';

const POOL = isSepolia
  ? process.env.NEXT_PUBLIC_STRK20_SEPOLIA_POOL ||
    '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91'
  : process.env.NEXT_PUBLIC_STRK20_POOL ||
    '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';

const BASE_ASSET = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'; // STRK

const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'umbra-launch.json');

const SUPPLY = '1073000000000000000000000000'; // 1,073,000,000e18
const VIRTUAL_BASE = '15000000000000000000'; // 15 STRK
const VIRTUAL_TOKEN = SUPPLY;
const GRAD_TARGET = '50000000000000000000'; // 50 STRK
const FEE_BPS = 100;

const contracts = ['Memecoin', 'BondingCurve', 'PrivateCurveExecutor', 'GraduationRouter', 'TokenFactory'];

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });
  console.log(`UMBRA LAUNCH deploy → ${NETWORK.toUpperCase()} (deployer ${deployerData.accountAddress})`);
  console.log(`pool=${POOL}`);

  const bounds = {
    l2_gas: { max_amount: 300000000n, max_price_per_unit: 200000000000n },
    l1_gas: { max_amount: 10000n, max_price_per_unit: 400000000000000n },
    l1_data_gas: { max_amount: 10000n, max_price_per_unit: 20000000000000n },
  };

  const artifacts = {};
  for (const name of contracts) {
    const sierra = json.parse(
      fs.readFileSync(path.join(DEV_DIR, `umbra_launch_${name}.contract_class.json`), 'utf8'),
    );
    const casm = json.parse(
      fs.readFileSync(path.join(DEV_DIR, `umbra_launch_${name}.compiled_contract_class.json`), 'utf8'),
    );
    artifacts[name] = {
      sierra,
      casm,
      classHash: hash.computeContractClassHash(sierra),
      compiledHash: hash.computeCompiledClassHash(casm),
    };
    console.log(`${name} class hash: ${artifacts[name].classHash}`);
  }

  const declared = {};
  for (const name of contracts) {
    const art = artifacts[name];
    console.log(`Declaring ${name}...`);
    const tx = await account.declareIfNot({ contract: art.sierra, casm: art.casm, classHash: art.classHash }, { resourceBounds: bounds });
    console.log(`  ${tx.class_hash} (${tx.transaction_hash ? 'tx ' + tx.transaction_hash : 'already declared'})`);
    declared[name] = tx.class_hash;
  }

  // GraduationRouter(governance)
  const routerClass = declared['GraduationRouter'];
  const routerDeploy = await account.deployContract({
    classHash: routerClass,
    constructorCalldata: CallData.compile({ governance: account.address }),
    unique: true,
    resourceBounds: bounds,
  });
  await provider.waitForTransaction(routerDeploy.transaction_hash);
  console.log(`GraduationRouter: ${routerDeploy.contract_address} (${routerDeploy.transaction_hash})`);

  // TokenFactory(governance, base, pool, router, mc, bc, exe)
  const factoryDeploy = await account.deployContract({
    classHash: declared['TokenFactory'],
    constructorCalldata: CallData.compile({
      governance: account.address,
      base_asset: BASE_ASSET,
      privacy_pool: POOL,
      router: routerDeploy.contract_address,
      memecoin_class_hash: declared['Memecoin'],
      curve_class_hash: declared['BondingCurve'],
      executor_class_hash: declared['PrivateCurveExecutor'],
    }),
    unique: true,
    resourceBounds: bounds,
  });
  await provider.waitForTransaction(factoryDeploy.transaction_hash);
  console.log(`TokenFactory: ${factoryDeploy.contract_address} (${factoryDeploy.transaction_hash})`);

  // Launch HAMSTR via the factory
  const createCalldata = CallData.compile({
    name: shortString.encodeShortString('HAMSTR'),
    symbol: shortString.encodeShortString('HAMSTR'),
    decimals: 18,
    metadata_uri: shortString.encodeShortString('ipfs://umbra-hamstr'),
    total_supply: SUPPLY,
    virtual_base_reserve: VIRTUAL_BASE,
    virtual_token_reserve: VIRTUAL_TOKEN,
    graduation_target: GRAD_TARGET,
    fee_bps: FEE_BPS,
  });
  const createRes = await account.execute(
    {
      contractAddress: factoryDeploy.contract_address,
      entrypoint: 'create_memecoin',
      calldata: createCalldata,
    },
    { resourceBounds: bounds },
  );
  await provider.waitForTransaction(createRes.transaction_hash);
  console.log(`create_memecoin(HAMSTR): ${createRes.transaction_hash}`);

  // Read back the created addresses (real on-chain reads)
  const read = async (entrypoint, arg) => {
    const r = await provider.callContract({
      contractAddress: factoryDeploy.contract_address,
      entrypoint,
      calldata: arg ? [arg] : [],
    });
    return '0x' + BigInt(r[0]).toString(16);
  };
  const token = await read('get_token', '0');
  const curve = await read('get_curve', '0');
  const executor = await read('get_executor', '0');

  const manifest = {
    network: NETWORK,
    updatedAt: new Date().toISOString(),
    contracts: {
      Memecoin: { classHash: declared['Memecoin'], status: 'DECLARED' },
      BondingCurve: { classHash: declared['BondingCurve'], status: 'DECLARED' },
      PrivateCurveExecutor: { classHash: declared['PrivateCurveExecutor'], status: 'DECLARED' },
      GraduationRouter: { address: routerDeploy.contract_address, txHash: routerDeploy.transaction_hash, status: 'DEPLOYED' },
      TokenFactory: { address: factoryDeploy.contract_address, txHash: factoryDeploy.transaction_hash, status: 'DEPLOYED' },
    },
    tokens: {
      HAMSTR: { token, curve, executor, createTx: createRes.transaction_hash, supply: SUPPLY },
    },
    baseAsset: BASE_ASSET,
    poolAddress: POOL,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${OUTPUT_FILE}`);
  console.log('\n.env.local additions:');
  console.log(
    isSepolia
      ? `NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY=${factoryDeploy.contract_address}`
      : `NEXT_PUBLIC_UMBRA_FACTORY=${factoryDeploy.contract_address}`,
  );
  console.log(`NEXT_PUBLIC_UMBRA_ROUTER=${routerDeploy.contract_address}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_TOKEN=${token}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_CURVE=${curve}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_EXECUTOR=${executor}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});