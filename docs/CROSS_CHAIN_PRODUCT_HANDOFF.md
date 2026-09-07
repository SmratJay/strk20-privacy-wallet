# Cross-chain product handoff — 2026-09-07

## Baseline and scope

Inspected current `main` at `b0d9c15d748a422cd280d65aff73481784bdff29`; the initial checkout was clean and matched `origin/main`. This report supersedes older single-destination product descriptions, not historical transaction evidence.

Preserved Wallet Core, Ready v0.4.0 account/class configuration, STRK20 SDK/contracts, discovery, Starkscan relay, Shadow Accounts and PrivacyHub. No deployment, contract address, root-wallet fallback, testnet fallback, replacement anonymizer or Robinhood API was introduced. Extended/perps, launchpad and landing design were not changed.

## Implemented

- `/cross-chain` is accessible from wallet actions and the desktop/mobile app menus.
- Canonical Starknet STRK → Base USDC remains. Solana routes are built from `GET /v0/tokens`, including exact IDs, mint addresses and decimals. Five-minute registry caching; failures are displayed without fabricated destinations.
- Shared NEAR route metadata feeds PrivacyHub; the UI uses WalletRuntime → PrivacyHub → NearIntentProvider → NearIntentAdapter → existing STRK20 Shadow Account → 1Click.
- Search, native/token identity disclosure, address validation, paste/copy, actual quotes, minimum output, provider deadlines, slippage, reported fees, readiness/deployment/balance gates, private deposit submission, solver polling, terminal states, manual reconciliation and chain-specific explorer links.
- Solana validation decodes base58 to exactly 32 bytes; quote/recipient comparisons preserve case. EVM zero destinations are rejected.
- Robinhood is only a user-supplied Solana address preset. The user must verify asset/network in Robinhood and acknowledge the exact warning. NEAR support is not presented as proof of Robinhood support or address ownership.
- Quote requests also use the Shadow Account refund address, so even dry requests no longer transmit the root address as refund metadata.
- Funding refuses expired deposits, changed routes/recipients/slippage, and a re-quoted minimum below the reviewed minimum. UI rejects stale quote responses after wallet/network/form changes.
- Source hashes are retained before solver polling. Unknown settlement blocks another transfer; missing/refund data is not replaced with invented source amounts. Only provider `SUCCESS` becomes “Settled.”
- Native browser `fetch` binding corrected. Current provider `{ hash, explorerUrl }` transaction records are normalized; links use known explorer hosts, not arbitrary API-provided URLs.
- Mainnet private execution additionally rejects a missing explicit HTTPS private paymaster in WalletPrivacySession, closing the lower-level default-Sepolia relay seam.
- Wallet onboarding/password labels and errors, counterfactual funding/deployment guidance, real public/private USD aggregation, activity links and private-swap network gating polished. Stablecoins are no longer valued at an assumed $1; USD prices come from the existing pricing service using actual CoinGecko USD data. Missing prices remain unavailable. Sepolia tokens have no real USD valuation.

## Audit findings and preserved seams

Mainnet anonymizer wiring already existed: `NEXT_PUBLIC_STRK20_ANONYMIZER_MAINNET` → `getNetworkConfig` → `resolveWalletPrivacyConfig` → `WalletPrivacySession` → `Strk20Adapter` → SDK shadow-account execution. No address was changed or deployed. The configuration still requires the supplied/verified AVNU STRK20 anonymizer.

Mainnet prover/discovery are explicit network-scoped configuration. The existing `/api/starkscan/prove` keeps `STARKSCAN_API_KEY` server-side. Ready Mainnet deployment and class hash were preserved, not reimplemented. The account must be funded at its counterfactual address before deployment; source private funds and relay fees are checked before execution.

The private-swap app registry currently contains a Sepolia application, not a Mainnet market. The panel now says so on Mainnet instead of showing a Sepolia token pair. Adding a real Mainnet market is a separate deployment/configuration task.

## External configuration

These values were **unset in this checkout's local environment**; this is not an assertion about the deployed Vercel environment:

| Setting | Required value |
| --- | --- |
| `NEXT_PUBLIC_STRK20_PROVER_URL_MAINNET` | Existing `/api/starkscan/prove` relay |
| `STARKSCAN_API_KEY` | Server-only Starkscan credential |
| `NEXT_PUBLIC_STRK20_DISCOVERY_URL_MAINNET` | Existing Mainnet service, `https://discovery.orrange.xyz` |
| `NEXT_PUBLIC_STRK20_ANONYMIZER_MAINNET` | Existing representative-supplied, verified AVNU STRK20 anonymizer address |
| `NEXT_PUBLIC_STRK20_PAYMASTER_URL_MAINNET` | Actual HTTPS Mainnet private relay supporting this pool/proof flow |

Keep the configured Mainnet RPC/pool and all Sepolia values separate. Next.js public environment changes require rebuilding the client bundle. Setting a URL alone does not prove operator availability or successful settlement. 1Click public token retrieval succeeded without credentials during this pass; if the provider requires credentials in a deployment, keep secrets server-side rather than adding them to public environment variables.

## Evidence and limits

- Read-only live registry request returned HTTP 200 with Base USDC and 17 Solana assets, including SOL, USDC and `$WIF`. BONK/POPCAT were not listed; no routes were invented for them. The runtime list can change with the provider.
- Browser checked actual registry loading, Solana selection, `$WIF` search/selection, unavailable BONK search, Robinhood warnings, malformed address rejection, configuration-disabled submission and mobile app navigation.
- Responsive checks at 1280px, 390px and 320px; narrow screen showed no horizontal document overflow.
- Focused automated tests cover route/address validation, provider response normalization, hub→shadow execution with mocked services, stale/expired input, no root execution, Mainnet relay gating, source-hash retention and non-fabricated USD prices. These are not live transaction evidence.
- Final checks passed: 127 tests in eight focused suites, `npx tsc --noEmit`, `npm run build`, and `git diff --check`. The full unrelated test suite was not run. Existing vendored SDK sourcemap/Vite warnings remain.
- No wallet was created through the browser, no funds were sent and no real proof, deployment, solver settlement or Robinhood credit was claimed.
- Transfer progress retains the existing session-scoped runtime model. Keep the wallet open and save the deposit reference. Reload/lock can discard the local progress view; use the provider status reference for reconciliation, not a second deposit. Automatic durable transfer history/refund recovery was not added.
- Refunds to the Shadow Account are not automatically restored to the STRK20 balance. Recovery must be tested separately using the existing execution/recovery capabilities.

Official API references: [token registry](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens), [execution status](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status).

## Final live test checklist

1. Configure Mainnet services and confirm their pool/chain/relay alignment. Verify the supplied anonymizer on-chain without replacing it.
2. Create/import and back up a Ready wallet; confirm Mainnet, fund its counterfactual address, deploy and observe finality.
3. Shield a small amount of STRK; wait for discovery/maturity. Verify public/private balances, private transfer, insufficient funds and rejected/failed proof states.
4. Test the existing Sepolia private swap independently. Mainnet private swap remains unavailable without a real configured market.
5. On Mainnet, quote a small Base USDC transfer; review destination, minimum and fees. Confirm private execution and verify the source caller is the Shadow Account, not the root wallet. Wait for 1Click `SUCCESS` and inspect destination explorer evidence.
6. Repeat for Solana SOL, USDC and a currently registry-listed meme token. Confirm token units, minimum output, case-sensitive recipient and real destination balances.
7. For Robinhood, obtain a fresh asset-specific Solana deposit address from Robinhood, verify exact asset/network support there, then test a small deposit. Provider settlement alone does not prove Robinhood account credit.
8. Test quote/deposit expiry, stale edits, network/wallet changes, delayed status, failed/refunded/incomplete deposits and Shadow Account recovery. Never retry an unconfirmed deposit by submitting another one.

## Changed-file inventory

- Product: `src/app/cross-chain/page.tsx`, `src/app/wallet/page.tsx`, `src/components/wallet/{AppShell,PrivateCrossChainPanel,PrivateSwapPanel,WalletCoreGate}.tsx`.
- Routing/provider: `src/features/near-intents/{address,registry,types,routes,client,adapter,config}.ts`; `src/features/privacy-hub/{types,routes,provider,service}.ts`.
- Existing integration seams: `src/wallet/{runtime,privacy}.ts`, `src/services/priceService.ts`.
- Focused regressions: `src/__tests__/{nearIntents,crossChainDestinations,walletUsdPrices}.test.ts`.
- Handoff: this file.
