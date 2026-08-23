# STRK20 Operator Infrastructure — Deployment Guide

The real STRK20 shield/unshield flow depends on two operator-side services. This doc tells
you exactly how to run them for **Starknet Sepolia**, then point the app at them.

## 1. What runs where

| Component | Image / Tag | Purpose | Required |
|---|---|---|---|
| Starknet node | `eqlabs/pathfinder:v0.22.7` (or a hosted RPC+WS) | RPC + WebSocket indexing | Yes |
| Discovery service | `ghcr.io/starkware-libs/starknet-privacy/discovery-service:PRIVACY-0.14.3-RC.2` | Note/channel discovery API | Yes |
| Transaction prover | `ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2` | Stwo validity proofs (`starknet_proveTransaction`) | Yes |
| Proof interceptor | `ghcr.io/starkware-libs/starknet-privacy/proof-interceptor:PRIVACY-0.14.3-RC.2` | Deposit screening sidecar | Optional |

### Version combination (intentional)

This repo vendors the **official Privacy SDK from the `PRIVACY-0.14.3-RC.5` git tag** (package `0.14.3-rc.5`), which exposes the `computeAndInvoke` builder used by the PEL STRK20 OPEN path (PEL bridge `privacy_compute` → `privacy_invoke_with_computation`).

- **SDK**     = official `PRIVACY-0.14.3-RC.5`
- **Prover**  = `PRIVACY-0.14.3-RC.2`
- **Discovery** = `PRIVACY-0.14.3-RC.2`
- **Pathfinder** = `v0.22.7`

This is an **intentional runtime compatibility combination**, not a set that was tested together upstream as one row. It must be **validated on-chain before it is considered production-ready** — see "Verify the stack" below. The SDK↔service wire protocols (`starknet_proveTransaction` / `starknet_specVersion`; `/health`, `/v1/sync/incoming_state`) are unchanged across these releases, and the deployed Sepolia privacy pool is the `CONTRACT_VERSION = '2.0'` pool that supports the `ComputeAndInvoke` action.

> All components in a row are tested together upstream. Use matching revisions when deploying.

## 2. Node

The discovery service and prover both need a node with **WebSocket** support for indexing.
Options:

- **Run Pathfinder** (recommended): see the `pathfinder` block in `docker-compose.yml`.
  Set `PATHFINDER_STORAGE_STATE_TRIES=10000` (required for the prover).
- **Hosted RPC+WS** for Sepolia (e.g. Alchemy / Infura / Nethermind). Use the same URL
  for `RPC_URL` and `WS_URL` (HTTP and WSS).

## 3. Discovery service

```bash
cd infra/strk20-operator
RPC_URL=https://your-sepolia-rpc WS_URL=wss://your-sepolia-ws docker compose up -d discovery-service
```

It serves an HTTP API on `http://localhost:8080`. Set in the app:

```
NEXT_PUBLIC_STRK20_DISCOVERY_URL=http://localhost:8080
```

## 4. Transaction prover (Stwo)

This is the heavy service that executes private actions in virtual Starknet blocks and returns
a STARK proof. Exact environment/config is documented in the sequencer repo README:
`starkware-libs/sequencer` → `crates/starknet_transaction_prover` (tag `PRIVACY-0.14.3-RC.2`).

Minimum known requirements:

- A local node (Pathfinder) with `PATHFINDER_STORAGE_STATE_TRIES=10000`.
- `chainId = SN_SEPOLIA` (0x534e5f5345504f4c4941).
- The privacy pool address / state the prover must simulate.

It exposes a JSON-RPC endpoint (`starknet_proveTransaction`). Set in the app:

```
NEXT_PUBLIC_STRK20_PROVER_URL=https://your-prover.example.com
```

## 5. Verify the stack

```bash
# Discovery service health
curl http://localhost:8080/health

# Then in the app, shield USDC on Sepolia: approve(pool) -> deposit -> note appears in
# the Shielded Balance (strk20SdkService.getShieldedBalance).
```

## 6. Network / address reference (Sepolia)

- Privacy pool: `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
- Official USDC:  `0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343`
- Pool class hash (mainnet tag reference): `0x52107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633`
