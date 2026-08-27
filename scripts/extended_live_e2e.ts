/**
 * @file scripts/extended_live_e2e.ts
 * @description Proves a real Extended Sepolia trading lifecycle end-to-end using the
 * SERVER credentials from the environment (EXTENDED_API_KEY / EXTENDED_STARK_PRIVATE_KEY /
 * EXTENDED_STARK_PUBLIC_KEY / EXTENDED_VAULT_ID). No secrets are embedded here.
 *
 * Flow: find a liquid perpetual market → market BUY (IOC, real fill) → read position →
 * market SELL (IOC, close) → verify final position state is empty.
 *
 * Run:  npx tsx scripts/extended_live_e2e.ts
 */

import { ExtendedServerClient } from '../src/extended/server';
import { ExtendedClient } from '../src/extended/client';
import type { Market } from '../src/extended/types';

const SLIPPAGE = 0.0075;
const roundToMinChange = (value: number, minChange: number): string => {
  const scaled = Math.floor(value / minChange);
  const dec = (String(minChange).split('.')[1] || '').length;
  return (scaled * minChange).toFixed(dec);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findLiquidMarket(client: ExtendedClient): Promise<Market> {
  const markets = await client.getMarkets();
  for (const m of markets) {
    if (m.type !== 'PERPETUAL' || !m.active || m.isRfq) continue;
    try {
      const ob = await client.getOrderbook(m.name);
      if (ob.bid.length > 0 && ob.ask.length > 0) {
        console.log('liquid market:', m.name, 'bid=%s ask=%s', ob.bid[0]?.price, ob.ask[0]?.price);
        return m;
      }
    } catch {
      // Skip markets whose orderbook is unavailable.
    }
  }
  throw new Error('No perpetual market with two-sided liquidity found on the testnet.');
}

async function main() {
  const required = [
    'EXTENDED_API_KEY',
    'EXTENDED_STARK_PRIVATE_KEY',
    'EXTENDED_STARK_PUBLIC_KEY',
    'EXTENDED_VAULT_ID',
  ] as const;
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required env var: ${name}`);
  }

  const server = new ExtendedServerClient();
  const publicClient = new ExtendedClient();
  console.log('server configured:', server.configured);

  const market = await findLiquidMarket(publicClient);
  const minQty = Number(market.tradingConfig.minOrderSize);
  const minPrice = Number(market.tradingConfig.minPriceChange);
  const qty = roundToMinChange(minQty, Number(market.tradingConfig.minOrderSizeChange));

  // OPEN: market BUY (IOC)
  const buyPrice = Number(market.marketStats.askPrice) * (1 + SLIPPAGE);
  const open = await server.placeOrder({
    market: market.name,
    side: 'BUY',
    qty,
    price: roundToMinChange(buyPrice, minPrice),
    type: 'MARKET',
    timeInForce: 'IOC',
  });
  console.log('OPEN order id:', open.id, 'externalId:', open.externalId);

  await sleep(2000);
  const afterOpen = await server.getAccountSnapshot();
  console.log('positions after open:', JSON.stringify(afterOpen.positions, null, 2).slice(0, 800));
  console.log('order history:', JSON.stringify(afterOpen.history, null, 2).slice(0, 800));
  if (afterOpen.positions.length === 0) throw new Error('No position after market BUY — order did not fill.');
  const pos = afterOpen.positions[0];
  console.log('REAL POSITION id:', pos.id, 'market=%s side=%s size=%s entry=%s', pos.market, pos.side, pos.size, pos.openPrice);

  // CLOSE: market SELL (IOC) opposite side
  const sellPrice = Number(market.marketStats.bidPrice) * (1 - SLIPPAGE);
  const close = await server.placeOrder({
    market: market.name,
    side: pos.side === 'LONG' ? 'SELL' : 'BUY',
    qty: pos.size,
    price: roundToMinChange(sellPrice, minPrice),
    type: 'MARKET',
    timeInForce: 'IOC',
  });
  console.log('CLOSE order id:', close.id);

  await sleep(2000);
  const final = await server.getAccountSnapshot();
  console.log('FINAL positions:', JSON.stringify(final.positions));
  if (final.positions.length !== 0) throw new Error('Position still open after close.');

  console.log('\n=== REAL LIFECYCLE PROVEN ===');
  console.log(JSON.stringify({ market: market.name, openOrderId: open.id, positionId: pos.id, closeOrderId: close.id }, null, 2));
}

main().catch((e) => {
  console.error('LIFECYCLE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});