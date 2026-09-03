# STRK20 Live Acceptance Procedure

This document defines the **live, funded** acceptance path for the Wallet Core STRK20 privacy
flow. It is the procedure a reviewer runs to prove a real, funded privacy transaction works end to
end. It is NOT a mocked test — anything executed here is a real on-chain STRK20 operation.

The automated live test lives in `src/__tests__/walletCoreRealNetwork.test.ts` under
"LIVE ACCEPTANCE — full privacy path". It skips honestly whenever any prerequisite is missing.

---

## 1. Required environment

| Prerequisite | How to check | Gate |
|---|---|---|
| Reachable Starknet Sepolia RPC | `npm test` real-network suite (non-skipped) | hard |
| STRK20 operator: prover | `NEXT_PUBLIC_STRK20_PROVER_URL` set + reachable | hard |
| STRK20 operator: discovery | `NEXT_PUBLIC_STRK20_DISCOVERY_URL` set + reachable (`/v1/sync/*`) | hard |
| Correct pool/config | Sepolia pool address resolves and its class hash is deployed | hard |
| Funded Sepolia wallet | STRK balance ≥ 2 STRK (fee headroom + a real deposit) | hard |
| Correct viewing-key config | `deriveWalletViewingKey` is canonical (in the STRK20 range) | hard |

The live test reads the operator URLs from the process environment
(`NEXT_PUBLIC_STRK20_PROVER_URL` / `NEXT_PUBLIC_STRK20_DISCOVERY_URL`). It does NOT read
`.env.local`, so run it with the env explicitly exported:

```bash
export NEXT_PUBLIC_STRK20_PROVER_URL=...   # operator prover
export NEXT_PUBLIC_STRK20_DISCOVERY_URL=... # operator discovery/indexer
npx vitest run src/__tests__/walletCoreRealNetwork.test.ts
```

## 2. The acceptance path

```
Wallet Core wallet
  ↓ (createWallet: real key, counterfactual Ready address)
wallet-native viewing key
  ↓ (deriveWalletViewingKey, canonical, network-scoped)
STRK20 registration
  ↓ (runtime.register(): real apply_actions registration, Wallet Core signer)
shield
  ↓ (runtime.shield(): real deposit + pool fee, Wallet Core signer)
private balance discovery
  ↓ (runtime.refreshPrivateBalances(): discovery service, wallet-native viewing key)
private transfer
  ↓ (runtime.privateTransfer(): real private transfer, Wallet Core signer)
withdraw
  ↓ (runtime.withdraw(): real withdrawal to public, Wallet Core signer)
```

Every step is submitted against real Sepolia and each `status` is asserted to be `PENDING` (a
real submitted transaction hash). Success is only claimed after the runtime's finality
reconciliation confirms it.

## 3. What is mocked vs executed

- **Mocked in unit tests**: `src/__tests__/walletStage3a.test.ts` ("STRK20 end-to-end acceptance
  path (mocked)") proves the runtime/session surface end to end with a stubbed STRK20 adapter —
  register → shield → balance → transfer → withdraw, explicit about the stub.
- **Live**: `walletCoreRealNetwork.test.ts` "LIVE ACCEPTANCE" executes the REAL path only when all
  gates pass; otherwise it skips with the exact reason and spends no funds.

## 4. Which live operations were actually executed

Fill this in after a funded run. Current status in this repository's test environment:

- RPC reachable: **yes**
- Operator prover configured in env: **configured, reachable (HTTP 405 on root = POST service up)**
- Operator discovery configured in env: **configured, but unreachable from the sandbox
  (connection timeout)**
- Funded Sepolia wallet: **no** (fresh counterfactual accounts are unfunded; no funding key in the repo)
- Real register / shield / balance / transfer / withdraw: **NOT executed** — skipped honestly
  because discovery is unreachable and no funded wallet is available. No fake success is reported.

When run in an environment that satisfies all gates, record the transaction hashes here.

## 5. Notes

- Deployment must reach 10-block finality before STRK20 proving is valid (the deployment state
  machine enforces this; see `MATURITY_BLOCKS`).
- The operator discovery service observes the wallet's IP, address, and viewing-key-scoped queries
  today (direct HTTPS). Enable `discoveryOhttp` only when the operator supports OHTTP/relay.