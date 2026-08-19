/**
 * @file keeperBot.ts
 * @description Autonomous Starknet Keeper Bot Process (Whitepaper Section 14)
 * Run standalone: `npx tsx keeper/keeperBot.ts`
 */

import { keeperService, LiquidationCandidate } from '../src/services/keeperService';
import { perpsService } from '../src/services/perpsService';
import { pragmaOracleService } from '../src/services/pragmaOracleService';

async function main() {
  console.log('===========================================================');
  console.log('  PEL DECENTRALIZED KEEPER WATCHDOG (STARKNET L2)');
  console.log('  Monitoring private perps solvency & liquidation bounds');
  console.log('===========================================================');

  const demoAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

  setInterval(async () => {
    try {
      const btcPrice = await pragmaOracleService.getMarketPrice('BTC/USD');
      console.log(`[${new Date().toISOString()}] Pragma BTC Mark: $${btcPrice.priceUsd.toFixed(2)} | Scanning active commitments...`);

      const positions = perpsService.getPositions(demoAddress);
      const candidates = await keeperService.scanPositionsForLiquidation(positions);

      if (candidates.length > 0) {
        console.warn(`🚨 FOUND ${candidates.length} LIQUIDATION CANDIDATE(S)!`);
        for (const c of candidates) {
          console.log(`  -> Liquidating Position ID: ${c.position.id}`);
          console.log(`     Market: ${c.position.marketId} ${c.position.side}`);
          console.log(`     Equity: $${c.equityUsd} <= Maint: $${c.maintenanceMarginUsd}`);
          console.log(`     ZK Fact Hash: ${c.factHash}`);
          console.log(`     Keeper Bounty Claimable: $${c.bountyEstimatedUsd}`);
        }
      } else {
        console.log(`  ✓ All monitored commitments solvent (Et > Mmaint). Zero breaches.`);
      }
    } catch (err: any) {
      console.error('Keeper watchdog error:', err.message);
    }
  }, 10000);
}

main();
