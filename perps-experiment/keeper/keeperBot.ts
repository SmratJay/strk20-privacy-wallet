/**
 * @file keeper/keeperBot.ts
 * @description Standalone Autonomous Starknet Keeper Bot Process (Whitepaper Section 14)
 *
 * Runs continuously in the background or as a daemon:
 *   `npx tsx keeper/keeperBot.ts`
 */

import { keeperService } from '../src/services/keeperService';
import { positionIndexerService } from '../src/services/positionIndexerService';
import { pragmaOracleService } from '../src/services/pragmaOracleService';
import { keeperWitnessStore } from '../src/services/keeperWitnessStore';

async function main() {
  console.log('===========================================================');
  console.log('  PEL AUTONOMOUS KEEPER SERVICE (STARKNET L2)');
  console.log('  Escrowed-witness liquidation daemon — runs without the trader online');
  console.log('===========================================================');

  const KEEPER_BENEFICIARY = process.env.KEEPER_RECIPIENT_ADDRESS || process.env.KEEPER_ADDRESS;
  if (!KEEPER_BENEFICIARY) {
    console.error('FATAL: KEEPER_RECIPIENT_ADDRESS or KEEPER_ADDRESS environment variable must be set.');
    process.exit(1);
  }
  const NETWORK = process.env.KEEPER_NETWORK || 'sepolia';
  console.log(`Keeper Beneficiary Address: ${KEEPER_BENEFICIARY}`);
  console.log(`Escrowed witnesses on ${NETWORK}: ${keeperWitnessStore.count(NETWORK)}`);

  // Start the production polling loop (retry/backoff/idempotency/graceful-shutdown).
  const intervalMs = Number(process.env.KEEPER_POLL_MS || 10000);
  keeperService.start(intervalMs).catch((err) => {
    console.error('Keeper service fatal error:', err);
    process.exit(1);
  });

  // Graceful shutdown on SIGINT/SIGTERM — never abandon an in-flight liquidation.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[Keeper] Shutting down gracefully...');
    await keeperService.stop();
    console.log('[Keeper] Stopped.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // A lightweight status tick so operators see liveness + metrics.
  setInterval(() => {
    const health = keeperService.getHealthStatus();
    const stats = keeperService.getRuntimeStats();
    console.log(
      `[${new Date().toISOString()}] ${NETWORK} | cycles=${stats.totalCycles} liq=${stats.totalLiquidations} ` +
        `retries=${stats.totalRetries} | oracleFresh=${health.oracleIsFresh} ` +
        `oracle=${(Number(health.oraclePriceCents) / 100).toFixed(2)} | activeIdx=${positionIndexerService.getActiveCommitments().length}`,
    );
  }, 30000);
}

main();
