# Private Swap — REAL STRK20 Shadow-Account Swap

## What this is

The one user-facing **private application** built on the existing STRK20 shadow-account
primitive. The user feels: **"Swap my private STRK"**. Everything below the button (prover,
discovery, commitment, shadow address, paymaster, notes, proofs, SDK actions) stays inside the
privacy layer and is never exposed to the UI.

```
UI (Private swap panel on /wallet)
  ↓ WalletRuntime.executePrivateSwap(intent)         [thin execute-private bridge]
  ↓ PrivateSwapService (src/features/private-swap)   [feature-level consumer]
  ↓ WalletPrivacySession.executeShadowApplication    [existing privacy layer]
  ↓ shadowAccountInvoke → SDK shadowAccounts(appName).invoke(nonce, { calls })
  ↓ private paymaster relay
  ↓ swap application (STRKFTW BondingCurve V2)
  ↓ buy output collected back into a private note → private STRKFTW
```

## Why not the AVNU SDK private-swap path

The installed `@avnu/avnu-sdk@4.2.0` DOES export a private-swap API (`executePrivateSwap`,
`buildStrk20Actions`, `createStrk20WalletProver`, `quoteToCalls({ private: true })`,
`SEPOLIA_PRIVACY_POOL_ADDRESS`). Two hard blockers make it unusable here:

1. **Zero Sepolia liquidity.** AVNU's Sepolia API serves an empty token registry
   (`totalElements: 0`) and returns `[]` for every quote pair tried (STRK→USDC, STRK→ETH,
   ETH→STRK, USDC→STRK on both `sepolia.api.avnu.fi` and `starknet.api.avnu.fi`). There is no
   real quote and no route to execute on Sepolia.
2. **Account incompatibility.** `createStrk20WalletProver(account)` requires a starknet.js
   `WalletAccountV6` exposing `strk20PrepareInvoke(actions)` — a different STRK20 action
   vocabulary than the vendored `@starkware-libs/starknet-privacy-sdk` 0.14.3-rc.5 builder that
   Wallet Core uses. Wiring it would require redesigning the Wallet Core account/proving path,
   which is explicitly out of scope.

Per the Phase 3 spec, the fallback is: **use the smallest real Starknet application where a
private swap-like state transition can be demonstrated; do not fake a DEX interaction.** The
repo's own **BondingCurve V2 (STRKFTW)** is a real, deployed, live constant-product AMM with real
STRK liquidity on Sepolia — a real swap application, not a mock.

## Pinned Sepolia application (real, live)

| Component | Address / value |
|---|---|
| Swap application (BondingCurve V2) | `0x1d63a2b150973cf8ae0c02dfbc564c1ed46fbf0a08b298c9d77b07b1c08b0f8` |
| Buy token (STRKFTW) | `0x4ce3233bdb393636c7a576e8d68a94f7d8c41ba4d38a42460782b270be85a00` (18 decimals) |
| Sell token (STRK) | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Quote view | `quote_buy(base_amount)` on-chain (real, bound to live reserves) |
| Swap entrypoint | `buy(base_amount, recipient)` |
| Curve fee | 1% (100 bps), split creator/protocol/curve |
| Max single trade | 10% of the virtual token reserve (execution constraint) |
| Privacy pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Shadow-account anonymizer | `0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f` |
| Private paymaster | `https://sepolia.paymaster.avnu.fi` (`default` mode, credential-free) |

## The swap flow

1. **Intent** — the UI submits a typed `PrivateSwapIntent` (sellToken, buyToken, sellAmount,
   slippageBps, appName, nonce). No arbitrary `targetContract + entrypoint + calldata` field
   exists; the feature owns the application contracts via `PRIVATE_SWAP_APPS`.
2. **Quote** — `quotePrivateSwap(intent)` reads `quote_buy(sellAmount)` on-chain and derives
   `minOutput = quote × (1 − slippage)` with integer math. The quote is bound to the exact pair +
   amount + network. The UI also gets the effective private-paymaster relay fee.
3. **Execution** — `executePrivateSwap(intent, confirmedQuote)`:
   - re-validates the intent (expired → refuse);
   - resolves the ACTIVE shadow identity scoped to the wallet + network by (appName, nonce);
   - re-quotes the curve and **rejects a stale/mutated quote** when the fresh output falls below
     the confirmed min-output;
   - builds the exact calls: `approve(STRK → curve, sellAmount)` + `buy(sellAmount, shadowAddress)`;
   - executes through the EXISTING shadow path: `WalletPrivacySession.executeShadowApplication`
     → `shadowAccountInvoke` → SDK `shadowAccounts(appName).invoke(nonce, { calls, collectPolicy })`
     → private paymaster relay.
4. **Collection** — the anonymizer settles the shadow account's post-invoke balance into open
   notes created in the same transaction: the **STRKFTW buy output** (via `collectTokens`) and the
   **STRK remainder** (via `collectRemainder`) both return to the private balance. No silent loss.
5. **Finality** — the runtime waits for on-chain reconciliation before reporting success; an
   unknown paymaster submission is reported honestly ("unknown"), never as success.

The swap application sees the **SHADOW ACCOUNT** as the trader (the anonymizer runs the calls from
the shadow account). The root wallet is neither the application caller nor the outer tx sender.

## Privacy guarantees

**Private:** the root-wallet → swap-application execution linkage, to the extent provided by the
STRK20 shadow-account protocol. The swap spend is a private-note proof; the outer tx is relayed by
the paymaster; the viewing key stays inside `WalletPrivacySession`; the master key never leaves
Wallet Core; no notes/proofs enter UI state or logs.

**Public (honest limits):** the initial shield, the shadow address (if observable), the swap
target + timing + amounts, the swap application's state, and the destination token holdings
according to the underlying application/account. **This is not an anonymity guarantee.**

## Transaction safety

- Exact decimal → base-unit parsing (bigint only, no float math).
- Token pair must match a `PRIVATE_SWAP_APPS` entry; unknown pairs are refused.
- Quote expiry: the confirmed quote is the floor; a fresh quote below min-output is rejected.
- Slippage is enforced at execution time (the app's `buy` has no on-chain min-out parameter, so
  the feature enforces it by re-quoting right before proving).
- The smallest safe allowance: `approve(curve, sellAmount)` for exactly the sell amount — no
  infinite allowance.
- Private balance/maturity is checked by the existing `selectMatureNotes` before proving.

## Live acceptance (VERIFIED, real on-chain)

On 2026-09-05 a REAL STRK20 shadow-account private swap passed end to end on Sepolia:

- Fresh Wallet Core wallet funded + deployed + reaching proving maturity.
- Shield (first shield auto-registers + auto-setups in ONE proof) → 30 STRK private balance.
- Shadow identity `(appName="orrange", nonce=0)` → real shadow account
  `0x3f1c199bec084d5fd20b365f693f11862afdd65cb8190f86af796cbc8273063` (deployed, runs the pinned
  shadow-account class `0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c`).
- **Private swap tx `0x748cb7785ee659dea129cb08408123f2826d8250c7d09f1bf987da4d9807594`** —
  `SUCCEEDED` / `ACCEPTED_ON_L2`, block `14597287`.
- Verified on-chain: the STRKFTW BondingCurve's `Buy` event recorded the SHADOW ACCOUNT as
  `trader` and `recipient` (NOT the root wallet), `base_amount` = `0.5 STRK`, `token_out` =
  `1.095891784417536435246149e24 STRKFTW base` (exactly the quoted output). The curve's real
  reserves moved (`base_reserve` 85.457→86.950 STRK, `token_reserve` 740.16e21→743.48e21 STRKFTW).
  The shadow account's STRKFTW balance after the tx is `0` — the buy output was collected back
  into a private STRKFTW note. The outer tx sender `0x22e60611…` differs from both the root wallet
  and the shadow account (the private paymaster relayed it).

**PRIVATE STRK → REAL SHADOW ACCOUNT → REAL SWAP APPLICATION → PRIVATE RESULT — verified live.**

## Files

- `src/features/private-swap/types.ts` — typed intent/quote/receipt/op-state + validation
- `src/features/private-swap/apps.ts` — `PRIVATE_SWAP_APPS` typed application registry
- `src/features/private-swap/quote.ts` — real on-chain quote + paymaster fee + approve calldata
- `src/features/private-swap/service.ts` — `PrivateSwapService` (quote → validate → build → execute)
- `src/features/private-swap/index.ts` — feature exports
- `src/wallet/runtime.ts` — thin `quotePrivateSwap` / `executePrivateSwap` bridge + `swapOp` lifecycle
- `src/components/wallet/PrivateSwapPanel.tsx` — the /wallet UI panel
- `src/privacy/strk20/shadowAccount.ts` — `collectTokens` (buy-token proceeds collection) + autoSetup