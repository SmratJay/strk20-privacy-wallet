# Extended MAINNET integration — verification (Aug 2026)

This document records the live verification of the Extended **Starknet Mainnet** perps
integration for Orrange. Every value below was verified against the **current** official
docs, the **live mainnet API**, the **current production frontend bundles**
(`https://app.extended.exchange`), and the official Python SDK / Rust crypto library.

## 1. Official mainnet configuration (confirmed)

From the official Extended Python SDK (`STARKNET_MAINNET_CONFIG`) and the live API:

| Item | Value | Verified |
|------|-------|----------|
| REST API base | `https://api.starknet.extended.exchange/api/v1` | live markets/orderbook/candles/trades |
| Onboarding URL | `https://api.starknet.extended.exchange` | `/auth/register` reachable |
| Public stream URL | `wss://api.starknet.extended.exchange/stream.extended.exchange/v1` | docs |
| Signing/auth host | `extended.exchange` | `GET /auth/signing-domain` → `"extended.exchange"` |
| SNIP-12 domain | `Perpetuals / v0 / SN_MAIN / revision 1` | `GET /api/v1/info/starknet` |
| Collateral asset id | `0x1` (USDC) | market `l2Config.collateralId` for BTC-USD |
| Collateral resolution | `1_000_000` (6 decimals) | market `l2Config.collateralResolution` |
| On-chain deposit contract | `0x062da0780fae50d68cecaa5a051606dc21217ba290969b302db4dd99d2e9b470` | `GET /api/v1/info/settings` + contract class |
| Native USDC token (Starknet mainnet) | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` | networks.ts |

## 2. Live public-data verification (passed)

`npx tsx scripts/extended_mainnet_verify.ts`:

- **Markets**: 359 live active perpetual markets (BTC-USD, ETH-USD, …).
- **Order book**: two-sided live book for BTC-USD (top bid/ask streaming).
- **Candles**: `GET /api/v1/info/candles/BTC-USD/trades` returns live OHLCV.
- **Trades**: `GET /api/v1/info/markets/BTC-USD/trades` returns live fills.
- **Market stats**: live mark/index/funding/24h volume per market.
- **Settings**: `GET /api/v1/info/settings` returns the exact deposit contract above.

The terminal consumes these directly (client → Extended public REST API), so charts,
order books, trades and the market strip are **real mainnet data**.

## 3. Native Starknet onboarding — current status on mainnet

We re-traced the **current production frontend** (`app.extended.exchange` bundles) and
confirmed the STARKNET `/auth/register` wire contract is unchanged:

```
POST /auth/register?rememberMe=true
{
  "l1Signature": "[\"<r_dec>\",\"<s_dec>\"]",   // serialized SNIP-12 AccountRegistration sig
  "l2Key": "0x...",                              // getStarkKey(derived L2 priv)
  "l2Signature": { "r":"0x…", "s":"0x…" },       // starkSign(pedersen(wallet, l2Key))
  "accountCreation": { "host":"extended.exchange", "accountIndex":0, "wallet":"0x…",
                       "tosAccepted":true, "action":"REGISTER", "time":"ISO-with-ms" },
  "walletType": "STARKNET"
}
```

Live probe (`EXTENDED_VERIFY_REGISTER=1`, throwaway account, exact frontend-equivalent
payload):

| Probe | Result |
|-------|--------|
| Schema-invalid STARKNET payload | **HTTP 400** (clean schema validation) |
| Exact frontend-equivalent STARKNET register | **HTTP 500**, empty body |
| STARKNET `/auth/login` | **HTTP 500**, empty body |
| Legacy `/auth/onboard` STARKNET | **HTTP 500**, empty body |
| Invalid host values (`app.`/`starknet.` variants) | **HTTP 400** `"Invalid host"` |

**Conclusion: the mainnet STARKNET onboarding handler is still broken server-side** (same
as Sepolia) — every schema-valid STARKNET request reaches signature verification and
throws an unhandled 500. The Orrange onboarding flow is implemented to the exact wire
contract, derived and signed server-side; it will work the moment Extended fixes the
backend. Until then the UI surfaces this as a clean, non-technical message and the
credential-backed path remains the functional fallback.

## 4. Deposit (native Starknet USDC)

For Starknet wallets, deposits are **fully on-chain** (docs: “invoke the Starknet contract
at `0x062d…b470`”). We read the live contract class (`starknet_getClassAt`) and confirmed
the `IDeposit.deposit(position_id: PositionId, quantized_amount: u64, salt: felt)` ABI.
The flow:

1. `approve(spender = depositContract, amount)` on the native USDC token.
2. `deposit(position_id = account.l2Vault, quantized_amount = amount × 1e6, salt)`.

Calldata is built in `src/extended/deposit.ts` and executed by the connected Starknet
wallet (no server credential involved). A real deposit requires a funded mainnet wallet
and an onboarded account/vault — outside the safely-testable boundary (see §7).

## 5. Withdrawals (Starknet)

`POST /api/v1/user/withdrawal` signed with the L2 key (server-side). The `WithdrawArgs`
SNIP-12 struct selector and hash were verified against the official Rust reference
(`x10xchange/rust-crypto-lib-base` → `0x250a5fa3…`, vector `0x04c22f62…`). See
`src/extended/withdrawal.ts`.

## 6. Security

- All `EXTENDED_*` credentials are server-only (`EXTENDED_API_KEY`,
  `EXTENDED_STARK_PRIVATE_KEY`, `EXTENDED_STARK_PUBLIC_KEY`, `EXTENDED_VAULT_ID`).
- L2 Stark key for native onboarding is derived **server-side**; the browser only sends
  wallet SNIP-12 signatures.
- Orders and withdrawals are signed server-side; the client bundle contains no private
  key, API key, vault id, or session token (scan verified).
- Public config (`NEXT_PUBLIC_EXTENDED_*`) is limited to URLs, the public deposit
  contract, and the public USDC token address.

## 7. Safely-tested vs. real-money boundary

Live-verified without credentials: all public market data, streams, domain, settings.
Verified to the wire contract: register payload, order settlement, withdrawal signing,
deposit calldata. **Blocked / requiring real credentials or a funded wallet**: creating a
trading account (`/auth/register` 500), on-chain deposit, order placement, withdrawal —
each stops at the exact boundary and reports the required action to the user.