#!/usr/bin/env node
/**
 * ORRANGE LAUNCHPAD V2 deployment script (Starknet Sepolia).
 *
 * 1. Declares the 5 launch contracts V2 from umbra-launch-contracts artifacts.
 * 2. Deploys GraduationRouter V2 + TokenFactory V2 (protocol treasury wired).
 * 3. Optionally launches the HAMSTR demo memecoin via the factory (--token).
 * 4. Writes deployments/umbra-launch-v2.json and prints the .env.local lines to wire the app.
 *
 * Safety: every tx hash and address is recorded from the actual chain responses. Nothing
 * is fabricated. Run `scarb build` in umbra-launch-contracts first (release profile:
 * SCARB_PROFILE=release scarb build).
 */
import { Account, RpcProvider, json, hash, CallData, shortString } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROFILE = process.env.UMBRA_BUILD_PROFILE || 'release';
const DEV_DIR = path.join(ROOT, `umbra-launch-contracts/target/${PROFILE}`);
const DEPLOYMENTS_DIR = path.join(ROOT, 'deployments');

const NETWORK = 'sepolia';

const RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

const POOL =
  process.env.NEXT_PUBLIC_STRK20_SEPOLIA_POOL ||
  '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91';

const BASE_ASSET = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'; // STRK

const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'umbra-launch-v2.json');

// V2 curve parameters (locked via scripts/launch_sim.mjs).
const SUPPLY = '1000000000000000000000000000'; // 1,000,000,000 tokens (18 dp)
const VIRTUAL_BASE = '30000000000000000000'; // 30 STRK
const VIRTUAL_TOKEN = SUPPLY;
const GRAD_TARGET = '120000000000000000000'; // 120 STRK
const FEE_BPS = 100; // 1% total
const CREATOR_FEE_BPS = 25; // 0.25% -> creator
const PROTOCOL_FEE_BPS = 25; // 0.25% -> protocol treasury
const MAX_TRADE_BPS = 1000; // 10% of virtual token reserve per buy

const contracts = ['Memecoin', 'BondingCurve', 'PrivateCurveExecutor', 'GraduationRouter', 'TokenFactory'];

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });
  // Protocol treasury: a dedicated address if provided, else the deployer (documented).
  const TREASURY =
    process.env.NEXT_PUBLIC_UMBRA_TREASURY || deployerData.accountAddress;

  console.log(`ORRANGE LAUNCHPAD V2 deploy → ${NETWORK.toUpperCase()} (deployer ${deployerData.accountAddress})`);
  console.log(`pool=${POOL}`);
  console.log(`treasury=${TREASURY}`);
  console.log(`curve V2: vBase ${Number(VIRTUAL_BASE) / 1e18} STRK · target ${Number(GRAD_TARGET) / 1e18} STRK · fee ${FEE_BPS}bps (creator ${CREATOR_FEE_BPS} · protocol ${PROTOCOL_FEE_BPS}) · maxTrade ${MAX_TRADE_BPS}bps`);

  const bounds = {
    l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
    l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
    l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
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
    console.log(`${name} V2 class hash: ${artifacts[name].classHash}`);
  }

  const declared = {};
  for (const name of contracts) {
    const art = artifacts[name];
    const ch = art.classHash;
    let already = false;
    try {
      await provider.getClassByHash(ch);
      already = true;
    } catch {
      already = false;
    }
    if (already) {
      console.log(`${name}: already declared (${ch})`);
      declared[name] = ch;
      continue;
    }
    console.log(`Declaring ${name}...`);
    try {
      const tx = await account.declareIfNot({ contract: art.sierra, casm: art.casm, classHash: ch }, { resourceBounds: bounds });
      console.log(`  ${tx.class_hash} (${tx.transaction_hash ? 'tx ' + tx.transaction_hash : 'already declared'})`);
      if (tx.transaction_hash) await provider.waitForTransaction(tx.transaction_hash);
      declared[name] = tx.class_hash;
    } catch (e) {
      if (String(e?.message ?? '').includes('already declared')) {
        console.log(`${name}: already declared (race handled, ${ch})`);
        declared[name] = ch;
        continue;
      }
      throw e;
    }
  }

  // Reuse previously deployed V2 router/factory from the manifest when present.
  let existing = {};
  try {
    const prior = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    if (prior.network === NETWORK) existing = prior;
  } catch {
    existing = {};
  }

  const routerAddress = existing.contracts?.GraduationRouter?.address || '';
  const factoryAddress = existing.contracts?.TokenFactory?.address || '';

  let router = routerAddress;
  if (router) {
    try {
      await provider.getClassHashAt(router);
      console.log(`GraduationRouter V2: reusing ${router}`);
    } catch {
      router = '';
    }
  }

  let factory = factoryAddress;
  if (factory) {
    try {
      await provider.getClassHashAt(factory);
      console.log(`TokenFactory V2: reusing ${factory}`);
    } catch {
      factory = '';
    }
  }

  if (!router) {
    // GraduationRouter(governance)
    const routerDeploy = await account.deployContract({
      classHash: declared['GraduationRouter'],
      constructorCalldata: CallData.compile({ governance: account.address }),
      unique: true,
      resourceBounds: bounds,
    });
    await provider.waitForTransaction(routerDeploy.transaction_hash);
    router = routerDeploy.contract_address;
    console.log(`GraduationRouter V2: ${router} (${routerDeploy.transaction_hash})`);
  }

  if (!factory) {
    // TokenFactory V2(governance, base, pool, router, treasury, mc, bc, exe)
    const factoryDeploy = await account.deployContract({
      classHash: declared['TokenFactory'],
      constructorCalldata: CallData.compile({
        governance: account.address,
        base_asset: BASE_ASSET,
        privacy_pool: POOL,
        router,
        protocol_treasury: TREASURY,
        memecoin_class_hash: declared['Memecoin'],
        curve_class_hash: declared['BondingCurve'],
        executor_class_hash: declared['PrivateCurveExecutor'],
      }),
      unique: true,
      resourceBounds: bounds,
    });
    await provider.waitForTransaction(factoryDeploy.transaction_hash);
    factory = factoryDeploy.contract_address;
    console.log(`TokenFactory V2: ${factory} (${factoryDeploy.transaction_hash})`);
  }

  const read = async (entrypoint, arg) => {
    const r = await provider.callContract({
      contractAddress: factory,
      entrypoint,
      calldata: arg ? [arg] : [],
    });
    return '0x' + BigInt(r[0]).toString(16);
  };

  // Launch HAMSTR via the factory (only with --token).
  let token = '';
  let curve = '';
  let executor = '';
  let createTx = '';
  const priorToken = existing.tokens?.HAMSTR;
  if (process.argv.includes('--token')) {
    if (priorToken && priorToken.token && priorToken.token !== '0x0') {
      token = priorToken.token;
      curve = priorToken.curve;
      executor = priorToken.executor;
      createTx = priorToken.createTx || '';
      console.log(`HAMSTR V2: reusing token ${token} curve ${curve}`);
    } else {
      const supply = BigInt(SUPPLY);
      const LOW_MASK = (1n << 128n) - 1n;
      const createCalldata = CallData.compile([
        shortString.encodeShortString('HAMSTR'),
        shortString.encodeShortString('HAMSTR'),
        18,
        shortString.encodeShortString('orrange://meta'),
        (supply & LOW_MASK).toString(),
        (supply >> 128n).toString(),
        BigInt(VIRTUAL_BASE).toString(),
        BigInt(VIRTUAL_TOKEN).toString(),
        BigInt(GRAD_TARGET).toString(),
        FEE_BPS,
        CREATOR_FEE_BPS,
        PROTOCOL_FEE_BPS,
        MAX_TRADE_BPS,
      ]);
      const createRes = await account.execute(
        {
          contractAddress: factory,
          entrypoint: 'create_memecoin',
          calldata: createCalldata,
        },
        { resourceBounds: bounds },
      );
      await provider.waitForTransaction(createRes.transaction_hash);
      createTx = createRes.transaction_hash;
      console.log(`create_memecoin(HAMSTR) V2: ${createTx}`);

      const lastId = BigInt(
        (await provider.callContract({ contractAddress: factory, entrypoint: 'get_token_count', calldata: [] }))[0],
      ) - 1n;
      const lastIdStr = lastId.toString();
      token = await read('get_token', lastIdStr);
      curve = await read('get_curve', lastIdStr);
      executor = await read('get_executor', lastIdStr);
    }
  }

  const manifest = {
    network: NETWORK,
    version: 'v2',
    updatedAt: new Date().toISOString(),
    contracts: {
      Memecoin: { classHash: declared['Memecoin'], status: 'DECLARED' },
      BondingCurve: { classHash: declared['BondingCurve'], status: 'DECLARED' },
      PrivateCurveExecutor: { classHash: declared['PrivateCurveExecutor'], status: 'DECLARED' },
      GraduationRouter: { address: router, txHash: existing.contracts?.GraduationRouter?.txHash || '', status: 'DEPLOYED' },
      TokenFactory: { address: factory, txHash: existing.contracts?.TokenFactory?.txHash || '', status: 'DEPLOYED' },
    },
    tokens: token
      ? { HAMSTR: { token, curve, executor, createTx, supply: SUPPLY } }
      : {},
    baseAsset: BASE_ASSET,
    poolAddress: POOL,
    protocolTreasury: TREASURY,
    curve: {
      virtualBase: VIRTUAL_BASE,
      virtualToken: VIRTUAL_TOKEN,
      graduationTarget: GRAD_TARGET,
      feeBps: String(FEE_BPS),
      creatorFeeBps: String(CREATOR_FEE_BPS),
      protocolFeeBps: String(PROTOCOL_FEE_BPS),
      maxTradeBps: String(MAX_TRADE_BPS),
    },
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${OUTPUT_FILE}`);
  console.log('\n.env.local additions:');
  console.log(`NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY=${factory}`);
  console.log(`NEXT_PUBLIC_UMBRA_ROUTER=${router}`);
  if (token) {
    console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_TOKEN=${token}`);
    console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_CURVE=${curve}`);
    console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_EXECUTOR=${executor}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});