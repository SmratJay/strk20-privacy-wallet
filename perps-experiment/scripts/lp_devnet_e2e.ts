/**
 * @file scripts/lp_devnet_e2e.ts
 * @description REAL Starknet devnet economic lifecycle for the canonical PEL LP
 * counterparty. Deploys TestUSDC -> PELInsuranceReserve -> PELLiquidityVault, wires
 * them, and executes the FULL golden lifecycle with real token balances:
 *   LP deposit -> shares -> trader profit (NAV down) -> trader loss (NAV up)
 *   -> liquidation (bounty / insurance / treasury) -> LP withdrawal claim.
 * Every assertion reads REAL on-chain state via provider.callContract and executes
 * REAL transactions via account.execute. Run: npx tsx scripts/lp_devnet_e2e.ts
 */

import { RpcProvider, Account, json, cairo, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(process.cwd());
const CORE_TARGET = path.join(ROOT, 'contracts', 'target', 'dev');
const RPC_URL = process.env.STARKNET_RPC || 'http://127.0.0.1:5050';
const TOKEN_MULT = 10_000n;

function readJson(p: string): any { return json.parse(fs.readFileSync(p, 'utf8')); }
function sierra(contract: string) { return readJson(path.join(CORE_TARGET, `pel_perpetuals_core_${contract}.contract_class.json`)); }
function casm(contract: string) { return readJson(path.join(CORE_TARGET, `pel_perpetuals_core_${contract}.compiled_contract_class.json`)); }

async function declareClass(account: Account, provider: RpcProvider, contract: string): Promise<string> {
  const sc = sierra(contract);
  try {
    const res = await account.declare({ contract: sc, casm: casm(contract) });
    await provider.waitForTransaction(res.transaction_hash);
    return res.class_hash;
  } catch (err: any) {
    if ((err?.message || '').includes('already declared')) return hash.computeSierraContractClassHash(sc);
    throw new Error(`DECLARE_FAILED(${contract}): ${err?.message}`);
  }
}

async function setTime(timestamp: number): Promise<void> {
  await fetch(RPC_URL + '/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'devnet_setTime', params: { timestamp } }),
  }).catch(() => {});
}

class Ctx {
  constructor(public provider: RpcProvider, public acct: Account, public addrs: Record<string, string>) {}
  resolve(addr?: string): string { return addr ? (this.addrs[addr] || addr) : this.addrs.vault; }
  async view(entrypoint: string, calldata: any[] = [], addr?: string): Promise<bigint> {
    const res = await this.provider.callContract({ contractAddress: this.resolve(addr), entrypoint, calldata });
    const s = res?.[0]?.toString?.() ?? '0x0';
    return BigInt(s === '0x' ? '0x0' : s);
  }
  async viewU256(entrypoint: string, calldata: any[] = [], addr?: string): Promise<bigint> {
    const res = await this.provider.callContract({ contractAddress: this.resolve(addr), entrypoint, calldata });
    const low = BigInt((res?.[0]?.toString?.() ?? '0x0').replace(/^0x$/, '0x0'));
    return low;
  }
  async exec(contract: string, entrypoint: string, calldata: any[]): Promise<void> {
    const tx = await this.acct.execute({ contractAddress: this.addrs[contract], entrypoint, calldata });
    const r = await this.provider.waitForTransaction(tx.transaction_hash);
    if ((r as any).execution_status === 'REVERTED' || (r as any).isReverted?.()) throw new Error(`TX_REVERTED ${entrypoint}`);
    await new Promise((r2) => setTimeout(r2, 300));
  }
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const accountsRes = await fetch(RPC_URL + '/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'devnet_getPredeployedAccounts', params: {} }),
  }).then((r) => r.json());
  if (!accountsRes?.result || accountsRes.result.length < 1) throw new Error('DEVNET_ACCOUNTS_UNAVAILABLE');
  const [a] = accountsRes.result;
  const admin = new Account({ provider, address: a.address, signer: a.private_key });

  console.log('=== PEL LP Devnet Economic E2E ===');
  const baseTime = Math.floor(Date.now() / 1000) + 7200;
  await setTime(baseTime);

  const usdcClass = await declareClass(admin, provider, 'TestUSDC');
  const usdcDep = await admin.deployContract({ classHash: usdcClass, constructorCalldata: [a.address] });
  await provider.waitForTransaction(usdcDep.transaction_hash);
  const usdc = usdcDep.contract_address;
  console.log(`1. TestUSDC deployed: ${usdc}`);

  const insClass = await declareClass(admin, provider, 'PELInsuranceReserve');
  const insDep = await admin.deployContract({ classHash: insClass, constructorCalldata: [a.address, usdc, '1000000'] });
  await provider.waitForTransaction(insDep.transaction_hash);
  const insurance = insDep.contract_address;
  console.log(`2. PELInsuranceReserve deployed: ${insurance}`);

  const vaultClass = await declareClass(admin, provider, 'PELLiquidityVault');
  const vaultDep = await admin.deployContract({ classHash: vaultClass, constructorCalldata: [a.address, usdc, a.address] });
  await provider.waitForTransaction(vaultDep.transaction_hash);
  const vault = vaultDep.contract_address;
  console.log(`3. PELLiquidityVault deployed: ${vault}`);

  const ctx = new Ctx(provider, admin, { vault, insurance, usdc });

  await ctx.exec('vault', 'set_pel_core_address', [a.address]);
  await ctx.exec('vault', 'set_insurance_reserve', [insurance]);
  await ctx.exec('insurance', 'set_authorized_caller', [vault, '1']);
  console.log('4. wired: vault.core=admin, vault.insurance=reserve, reserve.authorized=vault');

  const fund = 300_000_000n; // $3,000,000 in cents
  await ctx.exec('usdc', 'mint', [a.address, cairo.uint256(fund * TOKEN_MULT)]);
  await ctx.exec('usdc', 'approve', [vault, cairo.uint256(fund * TOKEN_MULT)]);
  console.log(`5. funded admin $${Number(fund) / 100}`);

  await ctx.exec('vault', 'deposit_liquidity', ['100000000']);
  const nav0 = await ctx.view('get_pool_nav');
  const shares = await ctx.view('get_lp_shares_balance', [a.address]);
  const price = await ctx.view('get_share_price_e6');
  console.log(`6. deposit $1,000,000 -> NAV=${nav0} shares=${shares} price=${price}`);
  if (nav0 !== 100_000_000n) throw new Error(`NAV ${nav0}`);
  if (shares !== 1_000_000_000_000n) throw new Error(`SHARES ${shares}`);
  if (price !== 1_000_000n) throw new Error(`PRICE ${price}`);
  console.log('   PASS: deposit mints 1,000,000,000,000 shares at $1.00');

await ctx.exec('vault', 'lock_trader_margin', [a.address, '0x1', '50000']);
  const locked = await ctx.view('get_locked_liquidity');
  if (locked !== 50_000n) throw new Error(`LOCKED ${locked}`);
  console.log('7. PASS: locked margin $500');

  await ctx.exec('vault', 'settle_trader_pnl', ['50000', '75000', '0xaa', a.address, '0']);
  const navProfit = await ctx.view('get_pool_nav');
  console.log(`8. trader profit $250 -> NAV=${navProfit} (expect ${100_000_000n - 25_000n})`);
  if (navProfit !== 100_000_000n - 25_000n) throw new Error(`NAV AFTER PROFIT ${navProfit}`);
  console.log('   PASS: LP pays full trader profit');

  const balBefore = await ctx.viewU256('balance_of', [a.address], 'usdc');
  await ctx.exec('vault', 'claim_payout_note', ['0xdead', '0xaa']);
  const balAfter = await ctx.viewU256('balance_of', [a.address], 'usdc');
  if (balAfter - balBefore !== 75_000n * TOKEN_MULT) throw new Error('PAYOUT NOT REAL');
  console.log(`9. PASS: payout note claimed as real USDC (+$${Number(75_000n * TOKEN_MULT) / Number(TOKEN_MULT) / 100})`);

  await ctx.exec('vault', 'lock_trader_margin', [a.address, '0x2', '50000']);
  await ctx.exec('vault', 'settle_trader_pnl', ['50000', '10000', '0x0', a.address, '0']);
  const navLoss = await ctx.view('get_pool_nav');
  console.log(`10. trader loss $400 -> NAV=${navLoss} (expect ${navProfit + 40_000n})`);
  if (navLoss !== navProfit + 40_000n) throw new Error(`NAV AFTER LOSS ${navLoss}`);
  console.log('   PASS: LP receives FULL trader loss');

  await ctx.exec('vault', 'lock_trader_margin', [a.address, '0x3', '50000']);
  await ctx.exec('vault', 'settle_liquidation', ['50000', '1000', a.address, '0', '0']);
  const bounty = await ctx.view('get_keeper_bounty_balance', [a.address]);
  const treasury = await ctx.view('get_treasury_balance');
  const insBal = await ctx.view('get_insurance_balance', [], 'insurance');
  const insTokens = await ctx.viewU256('balance_of', [insurance], 'usdc');
  console.log(`11. liquidation -> bounty=${bounty} treasury=${treasury} insurance=${insBal}`);
  if (bounty !== 1_000n) throw new Error(`BOUNTY ${bounty}`);
  if (treasury !== 4_900n) throw new Error(`TREASURY ${treasury}`);
  if (insBal !== 9_800n) throw new Error(`INSURANCE ${insBal}`);
  if (insTokens !== insBal * TOKEN_MULT) throw new Error(`INSURANCE NOT REAL ${insTokens}`);
  console.log('   PASS: liquidation 70/20/10 all routed; insurance holds real USDC');

  await setTime(baseTime + 7200);
  const totalShares = await ctx.view('get_total_lp_shares');
  const withdrawShares = totalShares / 10n;
  await ctx.exec('vault', 'request_withdrawal', [withdrawShares.toString()]);
  const pending = await ctx.view('get_pending_withdrawals_total');
  const sharesLeft = await ctx.view('get_lp_shares_balance', [a.address]);
  if (pending === 0n) throw new Error('WITHDRAWAL QUEUE EMPTY');
  if (sharesLeft !== totalShares - withdrawShares) throw new Error('SHARES NOT BURNED AT REQUEST');
  console.log(`12. PASS: Model A withdrawal queued (pending=${pending})`);

  const balWBefore = await ctx.viewU256('balance_of', [a.address], 'usdc');
  await ctx.exec('vault', 'claim_withdrawal', ['1']);
  const balWAfter = await ctx.viewU256('balance_of', [a.address], 'usdc');
  const pendingAfter = await ctx.view('get_pending_withdrawals_total');
  if (pendingAfter !== 0n) throw new Error('WITHDRAWAL NOT CLAIMED');
  if (balWAfter <= balWBefore) throw new Error('NO REAL WITHDRAWAL TOKENS');
  console.log(`13. PASS: withdrawal claimed as real USDC (+$${Number(balWAfter - balWBefore) / Number(TOKEN_MULT) / 100})`);

  const vaultTokens = (await ctx.viewU256('balance_of', [vault], 'usdc')) / TOKEN_MULT;
  const poolAssets = await ctx.view('get_pool_assets');
  const lockedNow = await ctx.view('get_locked_liquidity');
  const navNow = await ctx.view('get_pool_nav');
  const payoutsNow = await ctx.view('get_pending_withdrawals_total');
  const treasNow = await ctx.view('get_treasury_balance');
  const badDebtNow = await ctx.view('get_bad_debt_total');
  const lhs = vaultTokens + poolAssets;
  const rhs = lockedNow + navNow + payoutsNow + treasNow + badDebtNow;
  console.log(`14. conservation: tokens+poolAssets=${lhs} locked+NAV+P+W+Tr+badDebt=${rhs}`);
  if (lhs !== rhs) throw new Error(`CONSERVATION VIOLATION ${lhs} != ${rhs}`);
  console.log('   PASS: global conservation invariant holds on-chain');

  const manifest = { network: 'devnet', chainId: await provider.getChainId(), usdc, insurance, vault, accounts: { admin: a.address } };
  fs.writeFileSync(path.join(ROOT, 'deployments', 'lp-local.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest written to deployments/lp-local.json');
  console.log('=== ALL E2E STEPS PASSED ===');
}

main().catch((err) => { console.error('E2E FAILED:', err?.message || err); process.exit(1); });