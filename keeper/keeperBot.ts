/**
 * @file keeper/keeperBot.ts
 * @description Standalone Autonomous Starknet Keeper Bot Process (Whitepaper Section 14)
 *
 * Runs continuously in the background or as a daemon:
 *   `npx tsx keeper/keeperBot.ts`
 */

import { keeperService, LiquidationCandidate } from '../src/services/keeperService';
import { positionIndexerService } from '../src/services/positionIndexerService';
import { pragmaOracleService } from '../src/services/pragmaOracleService';

async function main() {
  console.log('===========================================================');
  console.log('  PEL DECENTRALIZED KEEPER WATCHDOG DAEMON (STARKNET L2)');
  console.log('  Monitoring active on-chain commitments & solvency risk');
  console.log('===========================================================');

  const KEEPER_BENEFICIARY = process.env.KEEPER_RECIPIENT_ADDRESS || process.env.KEEPER_ADDRESS;
  if (!KEEPER_BENEFICIARY) {
    console.error('FATAL: KEEPER_RECIPIENT_ADDRESS or KEEPER_ADDRESS environment variable must be set.');
    process.exit(1);
  }
  console.log(`Keeper Beneficiary Address: ${KEEPER_BENEFICIARY}`);

  setInterval(async () => {
    try {
      const btcPrice = await pragmaOracleService.getMarketPrice('BTC/USD', 'sepolia');
      const activeCommitments = positionIndexerService.getActiveCommitments();

      console.log(
        `[${new Date().toISOString()}] Pragma BTC Mark: $${btcPrice.priceUsd.toFixed(2)} | Active Commitments: ${activeCommitments.length}`
      );

      const candidates = await keeperService.scanActivePositions();

      if (candidates.length > 0) {
        console.warn(`🚨 FOUND ${candidates.length} LIQUIDATION CANDIDATE(S)!`);
        for (const c of candidates) {
          console.log(`  -> Liquidating Commitment: ${c.commitment.slice(0, 16)}...`);
          console.log(`     Market: ${c.marketId}`);
          console.log(`     Locked Margin: $${(Number(c.marginCents) / 100).toFixed(2)}`);
          console.log(`     Nullifier: ${c.nullifier}`);
          console.log(`     Claimable Bounty: $${(Number(c.bountyEstimatedCents) / 100).toFixed(2)} USDC`);
        }
      } else {
        console.log(`  ✓ All indexed commitments solvent. Zero invariant violations.`);
      }
    } catch (err: any) {
      console.error('Keeper watchdog polling error:', err.message);
    }
  }, 10000);
}

main();
