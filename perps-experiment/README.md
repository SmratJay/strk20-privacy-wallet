# perps-experiment

> **Legacy / hidden subsystem.** This directory is the frozen PEL (Private Execution Layer)
> perpetuals engine and its "financial super-app" terminal. It is intentionally **isolated
> from the production app** and is **excluded from the TypeScript build and the test runner**
> (see the `exclude` entries in the root `tsconfig.json` and `vitest.config.ts`).

The user-facing perps product has been pivoted to **Extended Exchange** (see
`src/extended/`). The normal Dapp presents Extended as the only perps experience.

## What lives here

- `src/services/` — the PEL engine: Groth16/STARK circuit service, oracle adapter, LP
  counterparty vault, position/daemon indexer, session-key/paymaster, STRK20 SDK lane,
  Starknet dispatcher, relayer security, and the canonical fixed-point/risk math.
- `src/protocol/` — PEL canonical protocol types, fixed-point math, LP vault, risk engine,
  witness store.
- `src/components/tabs/`, `src/components/terminal/` — the legacy terminal "super-app" UI
  (Perps / Earn / Portfolio / Swap / Shield / Send / Unshield / Request / Scanner / History).
- `src/app/terminal/` — the legacy `/terminal` route (removed from the app).
- `src/app/api/relayer/execute/` — the legacy PEL relayer endpoint (removed from the app).
- `src/__tests__/` — PEL protocol invariant tests (removed from the test runner).

## Why it is frozen

- The STRK20 wallet/privacy layer (`src/privacy`, `src/context`, `src/services/strk20WalletApiService.ts`)
  is the working foundation and must not be regressed.
- The PEL perps implementation is a hidden experiment/legacy subsystem and is **not** the
  production perps product.

## Restoring / re-enabling (do not do casually)

The files here still reference the old `@/` import layout and are intentionally NOT wired into
the app. To work on this subsystem again you must:

1. Re-map the `@/` path alias to this subtree (or restore the files to `src/`).
2. Remove `perps-experiment` from the root `tsconfig.json` / `vitest.config.ts` excludes.
3. Re-add the `/terminal` route and its navigation surface.

None of these are required for the current product.
