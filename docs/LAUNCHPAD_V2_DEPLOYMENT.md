# ORRANGE LAUNCHPAD V2 — Sepolia Deployment Record

Deployed **2026-08-30** on Starknet **Sepolia** (`0x534e5f5345504f4c4941`). V2 replaces V1;
the app reads only these contracts. `deployments/umbra-launch-v2.json` is the machine
manifest (gitignored, written by `scripts/launch_deploy.mjs`).

## Factory + Router

| Contract | Address | Deploy tx |
|----------|---------|-----------|
| GraduationRouter V2 | `0x654673a48fc3d93ae574b1b84c38420b85f1f1368f49995eabc81d814763fc6` | `0x44c44111a26b5f59aff56d7c2efb7f6c022549360f9cfbcb11eaf4143482db7` |
| TokenFactory V2 | `0x7d84fca356add599ff321142f6931bf2cc9477b0053c584c0ce5de8baf5c8c7` | `0x33413a48c22adf99a2ca4f20c54493df1904da12394f42c3b9729ff025ef2d8` |

- Base asset (STRK): `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- STRK20 privacy pool (executor binding): `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
- Protocol treasury: `0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d` (deployer; set via `NEXT_PUBLIC_UMBRA_TREASURY`)
- Event scan start block: `14275950` (just before factory deploy block `14275969`)

## Classes

| Contract | Class hash |
|----------|-----------|
| Memecoin | `0xf3d272721f25fd3c6bc880c7ca4e792393fe8dbe61545fbd1913faea63bd38` (unchanged from V1) |
| BondingCurve V2 | `0x34d107dc9d8f6b813db1afbb51ce3054e94bc0abcb51d507da723c759fc05e1` |
| PrivateCurveExecutor V2 | `0x721c9452316b1e2b6467cc13a8210b776c5cd7490a72c1b09a0bd027a4db9ff` |
| GraduationRouter V2 | `0x18b8401d7443bfba2c2460911250a5ae9216015dea018dc696dd06c5387d047` |
| TokenFactory V2 | `0x675579de30d7d2b94d3a76d094b42ef2a70806dbb2a2745c4b1428fc455c520` |

## Launched tokens

| Token | Token | Curve | Executor | Create tx |
|-------|-------|-------|----------|-----------|
| HAMSTR | `0x4964b055e813cf28450c71a68ecc6a4f857c807e2fb3aa0092ba9f096443b0b` | `0x3181e43caa5f9890a17ea6aef21b8074f4ffa8c98501c3857584bd32fac2f66` | `0x336fd9abce1ce0f16e20219e88071f67150cc182f060e5d1310a22c3787ecf4` | `0x58d6378fcf63ddb008eae60edda23620504d6b4b69248c9db83ad2e936a34dc` |
| STRKFTW | `0x4ce3233bdb393636c7a576e8d68a94f7d8c41ba4d38a42460782b270be85a00` | `0x1d63a2b150973cf8ae0c02dfbc564c1ed46fbf0a08b298c9d77b07b1c08b0f8` | `0x35cdb9196d270b6c3586411cba84f59a7edade76aee202e87ad71ec6a0cc838` | `0x417653bc425a7cfc52b6ae5d33f63e588d0d3de9ef564b612977e5a95f7965e` |

Curve V2 params (both tokens): supply 1B, virtual base 30 STRK, virtual token = supply,
graduation target 120 STRK, fee 1% (creator 25 bps / protocol 25 bps / 50 bps liquidity),
max buy 10% of virtual token reserve.

## Verified on-chain (2026-08-30)

- **Public buy/sell round trip** on both tokens; reserves return exactly to baseline after a
  full round trip; 1% total fee split visible on the chain (creator + protocol shares).
- **HAMSTR driven to graduation** (`launch_graduate.mjs`): the crossing buy auto-graduated the
  curve. `is_graduated=1`, `is_migrated=0` ("Curve Graduated, awaiting migration"). Router held
  **122.385 STRK** + **196,869,770.6 tokens**; curve drained to 0.
- **Migration** (`launch_migrate.mjs`, manager = deployer): `is_migrated=1`; reserves actually
  moved to the manager (1B tokens + 3035.04 STRK). The UI now shows CURVE GRADUATED · LIQUIDITY
  MIGRATED. No fake DEX claim — this is the truthful router boundary.
- **Executor locked to the STRK20 pool**: a non-pool `privacy_invoke` call REVERTED on-chain
  (`UNAUTHORIZED_CALLER`). Executor binds pool/curve/base/token exactly.
- **Cumulative volume / price history / trades** reconstruct from real Buy/Sell events
  (V2 layout carries `base_after`/`token_after`).

## Private lane

Private buy/sell is executed by the connected STRK20 wallet (Ready Wallet API or Privy lane)
in the app: `withdraw(input → executor) · transfer(OPEN note) · invoke(privacy_invoke)`, and
the pool applies the returned `OpenNoteDeposit` (same launched token as a STRK20 note). The
executor, its pool binding, and public/private price parity are verified on-chain and in the
61 snforge tests. A live private trade requires the app UI + a STRK20-capable wallet; it
cannot be reproduced from these scripts (proofs live in the wallet/SDK).

## Env wiring (`.env.local`)

```
NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY=0x7d84fca356add599ff321142f6931bf2cc9477b0053c584c0ce5de8baf5c8c7
NEXT_PUBLIC_UMBRA_ROUTER=0x654673a48fc3d93ae574b1b84c38420b85f1f1368f49995eabc81d814763fc6
NEXT_PUBLIC_UMBRA_HAMSTR_TOKEN=0x4964b055e813cf28450c71a68ecc6a4f857c807e2fb3aa0092ba9f096443b0b
NEXT_PUBLIC_UMBRA_HAMSTR_CURVE=0x3181e43caa5f9890a17ea6aef21b8074f4ffa8c98501c3857584bd32fac2f66
NEXT_PUBLIC_UMBRA_HAMSTR_EXECUTOR=0x336fd9abce1ce0f16e20219e88071f67150cc182f060e5d1310a22c3787ecf4
NEXT_PUBLIC_UMBRA_STRKFTW_TOKEN=0x4ce3233bdb393636c7a576e8d68a94f7d8c41ba4d38a42460782b270be85a00
NEXT_PUBLIC_UMBRA_STRKFTW_CURVE=0x1d63a2b150973cf8ae0c02dfbc564c1ed46fbf0a08b298c9d77b07b1c08b0f8
NEXT_PUBLIC_UMBRA_STRKFTW_EXECUTOR=0x35cdb9196d270b6c3586411cba84f59a7edade76aee202e87ad71ec6a0cc838
```