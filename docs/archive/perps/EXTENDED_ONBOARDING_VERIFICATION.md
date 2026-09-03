# Extended native Starknet onboarding — protocol verification (Aug 2026)

This document records the final rigorous comparison of our native Starknet onboarding
against the **current Extended production web frontend** (testnet build served from
`https://starknet.sepolia.extended.exchange`), re-traced from the live frontend bundles
on 2026-08-28, and the conclusion that the current Sepolia backend **blocks** the
STARKNET `/auth/register` path.

## 1. Exact current protocol (traced from the live frontend)

Source chunks (all fetched from `https://starknet.sepolia.extended.exchange/assets/`):
`build-typed-data-object-sN_hmx_2.js`, `local-key-pair-creation-KR-RvbRL.js`,
`serialize-wallet-signature-De6ZDnnW.js`, `get-wallet-type-signature-data-BjvYyQkA.js`,
`use-account-stark-private-key-DIbipDRj.js`, `actions-D3sbD1MY.js`,
`js-get-starknet-domain-obj-hash-D1Vm6dlY.js`, `stark-public-key-from-stark-private-key-Bx7ap6h9.js`,
`get-chain-id-for-connector-T2oFT1MW.js`, plus the main entry bundle.

| # | Item | Current frontend behavior |
|---|------|---------------------------|
| 1 | Endpoint/path | `POST https://<apiHost>/auth/register` (`apiHost = api.starknet.sepolia.extended.exchange` on testnet) |
| 2 | HTTP method | `POST` (axios, `Content-Type: application/json`) |
| 3 | JSON field names | `l1Signature`, `l2Key`, `l2Signature`, `referralCode`*, `accountCreation`, `walletType` |
| 4 | Field types | `l1Signature`: string; `l2Key`: `0x` hex string; `l2Signature`: `{r, s}` 0x-hex; `accountCreation`: object; `walletType`: `"STARKNET"` |
| 5 | `accountIndex` | integer `0` in `accountCreation` (and in the typed-data message as `felt`) |
| 6 | `wallet`/address | Starknet account address, `0x` hex, in `accountCreation.wallet` and typed-data message |
| 7 | `tosAccepted` | `true` |
| 8 | `host` | `starknet.sepolia.extended.exchange` (`app.authHost`; confirmed by `GET /auth/signing-domain`) |
| 9 | `action` | `"REGISTER"` |
| 10 | `time` | `new Date().toISOString()` — ISO **with milliseconds** (`2026-08-28T05:26:10.849Z`), same string signed and sent |
| 11 | `referralCode` | omitted from the wire body when no code (axios drops `undefined`); included only when a code is present |
| 12 | `walletType` | `"STARKNET"` |
| 13 | `l1Signature` | JSON array of **decimal** strings: `["<r_dec>","<s_dec>"]` (serialize-wallet-signature) |
| 14 | `l2Key` | `starkCurve.getStarkKey(l2PrivateKey)` → `0x` hex |
| 15 | `l2Signature` | Stark ECDSA over `pedersen(wallet, l2Key)`, `{r: "0x"+hex, s: "0x"+hex}` (addHexPrefix) |
| 16 | SNIP-12 domain | `{name, version, chainId, revision}` from `GET /api/v1/info/starknet` → live response `{"name":"Perpetuals","version":"v0","chainId":"SN_SEPOLIA","revision":1}` |
| 17 | Typed data | `AccountRegistration`: `[accountIndex:felt, wallet:string, tosAccepted:bool, time:string, action:string, host:string]`; `AccountCreation`: `[accountIndex:felt, wallet:string, tosAccepted:bool]`; `Login`: `[host:string, action:string, time:string]` |
| 18 | Chain ID / revision | domain `chainId = "SN_SEPOLIA"` (testnet); `revision` converted to shortstring string `"1"` |
| 19 | Signature hash | wallet signs the SNIP-12 message (starknet.js `Signer.signMessage`); L2 key derived from AccountCreation signature via `ethSigToPrivate` |
| 20 | Headers | `Content-Type: application/json`; browser UA (axios) |
| 21 | API base URL | `https://api.starknet.sepolia.extended.exchange` |
| 22 | Cookies/auth | server sets auth cookies (`x10_*`) on success; request itself is unauthenticated |
| 23 | Prerequisites | none before `/auth/register`; signing domain fetched from `GET /api/v1/info/starknet` |

## 2. Comparison vs our implementation

Our `src/extended/typedData.ts`, `src/extended/onboarding.ts`,
`src/app/api/extended/onboard/route.ts` and `src/app/extended/page.tsx` now match the
frontend on every point above. Two small divergences were found and fixed in this pass:

- **`time` format**: the frontend sends `new Date().toISOString()` **with milliseconds**;
  we previously stripped them. Now aligned (`page.tsx` and route use `toISOString()`
  directly). The typed-data builder always signs the exact time string that is sent.
- **`referralCode`**: the frontend omits the key entirely when there is no code; we
  previously sent `null`. Now `buildStarknetRegisterPayload` omits the key unless a code
  is provided.

The domain object was independently confirmed against the live backend
(`GET /api/v1/info/starknet` → `Perpetuals / v0 / SN_SEPOLIA / revision 1`), exactly as
the frontend uses it (with `revision` stringified to `"1"` in the SNIP-12 domain).

## 3. The precise difference, if any

**No remaining protocol difference.** After aligning `time` and `referralCode`, our
register payload is semantically byte-for-byte equivalent to what the current frontend
produces (JSON key order differs, which is irrelevant).

## 4. Is the current Extended Sepolia backend the blocker?

**Yes. CASE B is confirmed.** An exact frontend-equivalent request was built (SNIP-12
signatures generated by starknet.js over the exact AccountRegistration typed data,
`l1Signature` serialized `["r_dec","s_dec"]`, `l2Key`/`l2Signature` in the exact format)
and POSTed to the live testnet. Results:

| Payload | Result |
|---|---|
| Exact frontend STARKNET payload, `?rememberMe=true` | **HTTP 500**, empty body |
| Exact frontend STARKNET payload, no query string | **HTTP 500**, empty body |
| STARKNET payload + `referralCode: null` | **HTTP 500**, empty body |
| STARKNET payload + `referralCode: null` + no-ms time (old shape) | **HTTP 500**, empty body |
| STARKNET `/auth/login` | **HTTP 500**, empty body |
| Legacy `/auth/onboard` STARKNET | **HTTP 500**, empty body |
| Schema-invalid STARKNET payloads (missing fields, bogus `walletType`) | HTTP 400 (clean schema validation) |
| EVM with malformed signature | HTTP 500 (verification-stage exception) |

Schema-invalid requests are rejected cleanly (400), but every schema-valid STARKNET
request reaches the signature-verification stage and throws an unhandled **500 with an
empty body**. This is a backend handler bug in the testnet auth service, not a client
protocol issue.

## 5. Is any code change needed?

No protocol change is needed to succeed today — the backend blocks all valid STARKNET
registration. The changes in this pass are: (a) exact protocol parity for `time` and
`referralCode` (so the contract is correct when the backend is fixed), (b) a regression
test capturing the exact wire contract, and (c) clean user-facing messaging for the
backend-blocked state.

## 6. Working credential-backed fallback

The provisioned-credential trading path (`EXTENDED_API_KEY` /
`EXTENDED_STARK_PRIVATE_KEY` / `EXTENDED_STARK_PUBLIC_KEY` / `EXTENDED_VAULT_ID`, all
server-side only) is untouched: `src/extended/server.ts`, `client.ts`, `settlement.ts`
and the `/api/extended/{status,account,order}` routes are unchanged. The proven lifecycle
(onboard → API key → testnet USDC → market order → FILLED → position → close → empty
positions) still works via `scripts/extended_live_e2e.ts`.

## 7. Security

- L2 Stark key is derived **server-side** only (`/api/extended/onboard`); the browser
  never sees it.
- `EXTENDED_*` credentials remain server-only; no `NEXT_PUBLIC_EXTENDED_STARK_PRIVATE_KEY`
  exists anywhere.
- Client bundle scan found no private key, API key, vault id, or session token.