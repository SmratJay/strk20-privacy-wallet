/**
 * @file scripts/deploy_perps_devnet.ts
 * @description Clean deployment pipeline for the PEL private-perps protocol on a local
 * Starknet devnet, using the FIVE REAL Garaga Groth16 verifiers (one per circuit).
 *
 * Deploy order:
 *   1. declare universal ECIP ops class (must hash to the canonical ECIP class hash)
 *   2. declare + deploy the 5 circuit-specific verifiers
 *   3. deploy TestUSDC collateral token
 *   4. deploy OracleAdapter
 *   5. deploy STRK20Adapter
 *   6. deploy PELPerpsCore wired to the 5 distinct verifiers
 *   7. wire cross-contract authorization + publish oracle + mint/approve collateral
 *   8. write deployments/perps-local.json manifest
 */

import { RpcProvider, Account, json, hash, uint256 } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

// The verifiers in contracts/verifiers/* hardcode this ECIP ops class hash in their
// `library_call_syscall`. For a self-contained devnet deployment we compile the vendored
// `universal_ecip` contract and repoint the verifiers to its class hash (the canonical
// `0x396d5915…` class is only pre-declared on Sepolia/Mainnet).
export const ECIP_OPS_CLASS_HASH = '0x68cb2d4c66054da55ffe1544099e710adbf4dd619adc8b298ffee233a1c6c25';

const ROOT = path.join(process.cwd());
const CORE_TARGET = path.join(ROOT, 'contracts', 'target', 'dev');
const VERIFIER_TARGET = (name: string) =>
  path.join(ROOT, 'contracts', 'verifiers', `pel_${name}_verifier`, 'target', 'dev');
const ECIP_TARGET = path.join(ROOT, 'contracts', 'garaga_pkg', 'contracts', 'universal_ecip', 'target', 'dev');

export interface PerpsDevnetManifest {
  network: string;
  chainId: string;
  pelCore: string;
  oracleAdapter: string;
  strk20Adapter: string;
  pelStrk20Bridge: string;
  collateralToken: string;
  ecipClassHash: string;
  openVerifier: string;
  updateVerifier: string;
  fundVerifier: string;
  closeVerifier: string;
  liquidateVerifier: string;
  deploymentBlock: number;
  deploymentTxHashes: Record<string, string>;
  accounts: { admin: string; trader: string; keeper: string };
}

function readJson(p: string): any {
  return json.parse(fs.readFileSync(p, 'utf8'));
}

function readSierraCasm(pkg: string, contract: string, dir: string): { sierra: any; casm: any } {
  const sierra = readJson(path.join(dir, `${pkg}_${contract}.contract_class.json`));
  const casm = readJson(path.join(dir, `${pkg}_${contract}.compiled_contract_class.json`));
  return { sierra, casm };
}

async function declareIfNotExists(
  account: Account,
  provider: RpcProvider,
  sierra: any,
  casm: any | undefined,
): Promise<string> {
  try {
    const res = await account.declare(
      casm ? { contract: sierra, casm } : { contract: sierra, compiledClassHash: '0x0' },
    );
    await provider.waitForTransaction(res.transaction_hash);
    return res.class_hash;
  } catch (err: any) {
    const msg = err?.message || err?.baseError?.data?.execution_error || '';
    if (msg.includes('already declared')) {
      return hash.computeSierraContractClassHash(sierra);
    }
    throw new Error(`CONTRACT_DECLARATION_FAILED: ${msg}`);
  }
}

async function declareEcip(account: Account, provider: RpcProvider): Promise<string> {
  const { sierra, casm } = readSierraCasm('universal_ecip', 'UniversalECIP', ECIP_TARGET);
  // The class hash MUST match the canonical ECIP ops class hash that the Garaga
  // verifiers hardcode in their `library_call_syscall`. If it does not, proofs will
  // fail on-chain with a missing class.
  const computed = hash.computeSierraContractClassHash(sierra);
  if (BigInt(computed) !== BigInt(ECIP_OPS_CLASS_HASH)) {
    throw new Error(
      `ECIP_CLASS_HASH_MISMATCH: expected ${ECIP_OPS_CLASS_HASH}, got ${computed}. ` +
      'Rebuild universal_ecip with the pinned toolchain (scarb 2.16.1, garaga 1.1.0).',
    );
  }
  try {
    const res = await account.declare({ contract: sierra, casm });
    await provider.waitForTransaction(res.transaction_hash);
    return res.class_hash;
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('already declared')) return ECIP_OPS_CLASS_HASH;
    throw new Error(`ECIP_DECLARATION_FAILED: ${msg}`);
  }
}

export interface DevnetAccounts {
  admin: Account;
  trader: Account;
  keeper: Account;
  adminAddress: string;
  traderAddress: string;
  keeperAddress: string;
}

export async function resolveDevnetAccounts(provider: RpcProvider, rpcUrl: string): Promise<DevnetAccounts> {
  if (process.env.STARKNET_ADMIN_PRIVATE_KEY && process.env.STARKNET_ADMIN_ADDRESS) {
    const adminAddress = process.env.STARKNET_ADMIN_ADDRESS;
    const admin = new Account({ provider, address: adminAddress, signer: process.env.STARKNET_ADMIN_PRIVATE_KEY });
    const traderAddress = process.env.STARKNET_TEST_ACCOUNT_ADDRESS || adminAddress;
    const trader = new Account({
      provider,
      address: traderAddress,
      signer: process.env.STARKNET_TEST_ACCOUNT_PRIVATE_KEY || process.env.STARKNET_ADMIN_PRIVATE_KEY,
    });
    return { admin, trader, keeper: admin, adminAddress, traderAddress, keeperAddress: adminAddress };
  }
  const accountsRes = await fetch(rpcUrl + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'devnet_getPredeployedAccounts', params: {} }),
  }).then((r) => r.json());
  if (!accountsRes?.result || accountsRes.result.length < 3) {
    throw new Error('DEVNET_ACCOUNTS_UNAVAILABLE');
  }
  const [a, t, k] = accountsRes.result;
  const mk = (acc: any) => new Account({ provider, address: acc.address, signer: acc.private_key });
  return {
    admin: mk(a),
    trader: mk(t),
    keeper: mk(k),
    adminAddress: a.address,
    traderAddress: t.address,
    keeperAddress: k.address,
  };
}

export async function deployPerpsDevnet(rpcUrl = 'http://127.0.0.1:5050'): Promise<PerpsDevnetManifest> {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = await provider.getChainId();
  const accs = await resolveDevnetAccounts(provider, rpcUrl);
  const txHashes: Record<string, string> = {};
  const { admin, trader, keeper, adminAddress, traderAddress, keeperAddress } = accs;

  // 1. ECIP class
  const ecipClassHash = await declareEcip(admin, provider);

  // 2. Five circuit-specific verifiers (sierra + casm)
  const verifierNames = ['open', 'update', 'fund', 'close', 'liquidate'] as const;
  const verifiers: Record<string, string> = {};
  for (const name of verifierNames) {
    const dir = VERIFIER_TARGET(name);
    const pkg = `pel_${name}_verifier`;
    const { sierra, casm } = readSierraCasm(pkg, 'Groth16VerifierBN254', dir);
    const classHash = await declareIfNotExists(admin, provider, sierra, casm);
    const dep = await admin.deployContract({ classHash, constructorCalldata: [] });
    await provider.waitForTransaction(dep.transaction_hash);
    verifiers[name] = dep.contract_address;
    txHashes[`verifier_${name}`] = dep.transaction_hash;
  }

  // 3. TestUSDC
  const usdc = readSierraCasm('pel_perpetuals_core', 'TestUSDC', CORE_TARGET);
  const usdcClassHash = await declareIfNotExists(admin, provider, usdc.sierra, usdc.casm);
  const usdcDep = await admin.deployContract({ classHash: usdcClassHash, constructorCalldata: [adminAddress] });
  await provider.waitForTransaction(usdcDep.transaction_hash);
  const usdcAddress = usdcDep.contract_address;
  txHashes.usdc = usdcDep.transaction_hash;

  // 4. OracleAdapter
  const oracle = readSierraCasm('pel_perpetuals_core', 'OracleAdapter', CORE_TARGET);
  const oracleClassHash = await declareIfNotExists(admin, provider, oracle.sierra, oracle.casm);
  const oracleDep = await admin.deployContract({ classHash: oracleClassHash, constructorCalldata: [adminAddress, adminAddress] });
  await provider.waitForTransaction(oracleDep.transaction_hash);
  const oracleAddress = oracleDep.contract_address;
  txHashes.oracleAdapter = oracleDep.transaction_hash;

  // 5. STRK20Adapter
  const strk20 = readSierraCasm('pel_perpetuals_core', 'STRK20Adapter', CORE_TARGET);
  const strk20ClassHash = await declareIfNotExists(admin, provider, strk20.sierra, strk20.casm);
  const strk20Dep = await admin.deployContract({ classHash: strk20ClassHash, constructorCalldata: [adminAddress, adminAddress, usdcAddress] });
  await provider.waitForTransaction(strk20Dep.transaction_hash);
  const strk20Address = strk20Dep.contract_address;
  txHashes.strk20Adapter = strk20Dep.transaction_hash;

  // 6. PELPerpsCore wired to the five DISTINCT verifiers
  const core = readSierraCasm('pel_perpetuals_core', 'PELPerpsCore', CORE_TARGET);
  const coreClassHash = await declareIfNotExists(admin, provider, core.sierra, core.casm);
  const coreDep = await admin.deployContract({
    classHash: coreClassHash,
    constructorCalldata: [
      adminAddress,
      oracleAddress,
      strk20Address,
      verifiers.open,
      verifiers.update,
      verifiers.fund,
      verifiers.close,
      verifiers.liquidate,
    ],
  });
  await provider.waitForTransaction(coreDep.transaction_hash);
  const coreAddress = coreDep.contract_address;
  txHashes.pelCore = coreDep.transaction_hash;

  // 6b. PELPerpsSTRK20Bridge wired to the five DISTINCT verifiers + STRK20Adapter.
  //     On devnet there is no real privacy pool, so we point the bridge at the admin
  //     address as a placeholder for the pool caller (the pool is the only authorized
  //     caller of privacy_compute / privacy_invoke_with_computation).
  const bridge = readSierraCasm('pel_perpetuals_core', 'PELPerpsSTRK20Bridge', CORE_TARGET);
  const bridgeClassHash = await declareIfNotExists(admin, provider, bridge.sierra, bridge.casm);
  const bridgeDep = await admin.deployContract({
    classHash: bridgeClassHash,
    constructorCalldata: [
      adminAddress,                 // admin
      adminAddress,                 // pool (devnet placeholder — real pool on Sepolia/Mainnet)
      coreAddress,                  // pel_core
      strk20Address,                // strk20_adapter (protocol-side LP/insurance value)
      verifiers.open,
      verifiers.update,
      verifiers.fund,
      verifiers.close,
      verifiers.liquidate,
    ],
  });
  await provider.waitForTransaction(bridgeDep.transaction_hash);
  const bridgeAddress = bridgeDep.contract_address;
  txHashes.pelStrk20Bridge = bridgeDep.transaction_hash;

  // 7. Wire + fund
  const setCore = await admin.execute({ contractAddress: strk20Address, entrypoint: 'set_pel_core_address', calldata: [coreAddress] });
  await provider.waitForTransaction(setCore.transaction_hash);
  txHashes.wire_set_pel_core = setCore.transaction_hash;

  // Authorize the bridge as the STRK20-collateral OPEN path in PELPerpsCore.
  const setBridge = await admin.execute({ contractAddress: coreAddress, entrypoint: 'set_bridge', calldata: [bridgeAddress] });
  await provider.waitForTransaction(setBridge.transaction_hash);
  txHashes.wire_set_bridge = setBridge.transaction_hash;

  const setOracle = await admin.execute({ contractAddress: coreAddress, entrypoint: 'set_oracle_adapter', calldata: [oracleAddress] });
  await provider.waitForTransaction(setOracle.transaction_hash);
  txHashes.wire_set_oracle = setOracle.transaction_hash;

  const block = await provider.getBlock('latest');
  const publish = await admin.execute({
    contractAddress: oracleAddress,
    entrypoint: 'publish_oracle_price',
    calldata: ['0x4254432d50455250', '0x90f560', '0x' + block.timestamp.toString(16)],
  });
  await provider.waitForTransaction(publish.transaction_hash);
  txHashes.oracle_publish = publish.transaction_hash;

  // mint collateral to trader + keeper, approve adapter
  const mintAmt = uint256.bnToUint256(1_000_000_000_000n * 10000n); // 1e9 cents in token units
  for (const [name, addr] of [['trader', traderAddress], ['keeper', keeperAddress]] as const) {
    const mint = await admin.execute({
      contractAddress: usdcAddress,
      entrypoint: 'mint',
      calldata: [addr, '0x' + BigInt(mintAmt.low).toString(16), '0x' + BigInt(mintAmt.high).toString(16)],
    });
    await provider.waitForTransaction(mint.transaction_hash);
    txHashes[`mint_${name}`] = mint.transaction_hash;
  }
  const approveUnits = 500000n * 10000n; // 500k cents margin
  const approve = await trader.execute({
    contractAddress: usdcAddress,
    entrypoint: 'approve',
    calldata: [strk20Address, '0x' + approveUnits.toString(16), '0x0'],
  });
  await provider.waitForTransaction(approve.transaction_hash);
  txHashes.trader_approve = approve.transaction_hash;

  const manifest: PerpsDevnetManifest = {
    network: 'devnet',
    chainId,
    pelCore: coreAddress,
    oracleAdapter: oracleAddress,
    strk20Adapter: strk20Address,
    pelStrk20Bridge: bridgeAddress,
    collateralToken: usdcAddress,
    ecipClassHash,
    openVerifier: verifiers.open,
    updateVerifier: verifiers.update,
    fundVerifier: verifiers.fund,
    closeVerifier: verifiers.close,
    liquidateVerifier: verifiers.liquidate,
    deploymentBlock: await provider.getBlockNumber(),
    deploymentTxHashes: txHashes,
    accounts: { admin: adminAddress, trader: traderAddress, keeper: keeperAddress },
  };

  if (!fs.existsSync(path.join(ROOT, 'deployments'))) fs.mkdirSync(path.join(ROOT, 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'deployments', 'perps-local.json'), JSON.stringify(manifest, null, 2));

  return manifest;
}
