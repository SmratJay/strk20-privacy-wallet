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
// Deploy with the RELEASE profile: the dev profile enables `panic-backtrace`, which
// injects the `trace` libfunc that the on-chain Sierra compiler rejects (not in the
// 'audited' libfuncs list). Override with UMBRA_BUILD_PROFILE=dev if ever needed.
const PROFILE = process.env.UMBRA_BUILD_PROFILE || 'release';
const DEV_DIR = path.join(ROOT, `umbra-launch-contracts/target/${PROFILE}`);
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
    // Keep l2_gas under the node's per-tx cap (~1.21B) while far above the ~300-500M a
    // declare/create actually uses.
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
    console.log(`${name} class hash: ${artifacts[name].classHash}`);
  }

  const declared = {};
  for (const name of contracts) {
    const art = artifacts[name];
    const ch = art.classHash;
    // Explicit on-chain check first: declareIfNot's internal check can race a just-declared
    // class (fresh class hash not yet propagated to the node's lookup), which then fails the
    // account validation with "already declared".
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
      // Wait for confirmation so the account nonce advances before the next tx (the node
      // still returns the old nonce while the previous declare is unconfirmed).
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

  // Reuse previously deployed router/factory from the manifest when present (idempotent
  // reruns — never deploy duplicate instances).
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
      await provider.getClassHashAt(router); // verify it still exists on-chain
      console.log(`GraduationRouter: reusing ${router}`);
    } catch {
      router = '';
    }
  }

  let factory = factoryAddress;
  if (factory) {
    try {
      await provider.getClassHashAt(factory);
      console.log(`TokenFactory: reusing ${factory}`);
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
    console.log(`GraduationRouter: ${router} (${routerDeploy.transaction_hash})`);
  }

  if (!factory) {
    // TokenFactory(governance, base, pool, router, mc, bc, exe)
    const factoryDeploy = await account.deployContract({
      classHash: declared['TokenFactory'],
      constructorCalldata: CallData.compile({
        governance: account.address,
        base_asset: BASE_ASSET,
        privacy_pool: POOL,
        router,
        memecoin_class_hash: declared['Memecoin'],
        curve_class_hash: declared['BondingCurve'],
        executor_class_hash: declared['PrivateCurveExecutor'],
      }),
      unique: true,
      resourceBounds: bounds,
    });
    await provider.waitForTransaction(factoryDeploy.transaction_hash);
    factory = factoryDeploy.contract_address;
    console.log(`TokenFactory: ${factory} (${factoryDeploy.transaction_hash})`);
  }

  // Read back the created addresses (real on-chain reads)
  const read = async (entrypoint, arg) => {
    const r = await provider.callContract({
      contractAddress: factory,
      entrypoint,
      calldata: arg ? [arg] : [],
    });
    return '0x' + BigInt(r[0]).toString(16);
  };

  // Launch HAMSTR via the factory (skipped when already created — manifest carries the
  // addresses so reruns are no-ops).
  let token = '';
  let curve = '';
  let executor = '';
  let createTx = '';
  const priorToken = existing.tokens?.HAMSTR;
  if (priorToken && priorToken.token && priorToken.token !== '0x0') {
    token = priorToken.token;
    curve = priorToken.curve;
    executor = priorToken.executor;
    createTx = priorToken.createTx || '';
    console.log(`HAMSTR: reusing token ${token} curve ${curve}`);
  } else {
    // Build flat calldata: total_supply is a u256 and MUST be split low/high manually —
    // CallData.compile without an ABI treats a bigint/string as a single felt252, which
    // misaligns every following parameter.
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
    console.log(`create_memecoin(HAMSTR): ${createTx}`);

    // Read back the created addresses (real on-chain reads) — the new token is the last one.
    const lastId = BigInt(
      (await provider.callContract({ contractAddress: factory, entrypoint: 'get_token_count', calldata: [] }))[0],
    ) - 1n;
    const lastIdStr = lastId.toString();
    token = await read('get_token', lastIdStr);
    curve = await read('get_curve', lastIdStr);
    executor = await read('get_executor', lastIdStr);
  }

  const manifest = {
    network: NETWORK,
    updatedAt: new Date().toISOString(),
    contracts: {
      Memecoin: { classHash: declared['Memecoin'], status: 'DECLARED' },
      BondingCurve: { classHash: declared['BondingCurve'], status: 'DECLARED' },
      PrivateCurveExecutor: { classHash: declared['PrivateCurveExecutor'], status: 'DECLARED' },
      GraduationRouter: { address: router, txHash: existing.contracts?.GraduationRouter?.txHash || '', status: 'DEPLOYED' },
      TokenFactory: { address: factory, txHash: existing.contracts?.TokenFactory?.txHash || '', status: 'DEPLOYED' },
    },
    tokens: {
      HAMSTR: { token, curve, executor, createTx, supply: SUPPLY },
    },
    baseAsset: BASE_ASSET,
    poolAddress: POOL,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${OUTPUT_FILE}`);
  console.log('\n.env.local additions:');
  console.log(
    isSepolia
      ? `NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY=${factory}`
      : `NEXT_PUBLIC_UMBRA_FACTORY=${factory}`,
  );
  console.log(`NEXT_PUBLIC_UMBRA_ROUTER=${router}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_TOKEN=${token}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_CURVE=${curve}`);
  console.log(`NEXT_PUBLIC_UMBRA_HAMSTR_EXECUTOR=${executor}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});