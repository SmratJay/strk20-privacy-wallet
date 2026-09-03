"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { WalletRuntime } from "@/wallet/runtime";
import type { WalletRuntimeView } from "@/wallet/runtime";

/**
 * Wallet Runtime — the primary Orrange wallet runtime (Wallet Core backed, NO Privy).
 *
 * This is the ONLY wallet runtime in the product. It is intentionally independent of any legacy
 * wallet runtime that previously existed; a locked/empty runtime shows "wallet exists → locked".
 *
 * SUBSCRIPTION MODEL: consumers subscribe to the runtime through `useWalletRuntime()` using
 * `useSyncExternalStore`. This is the idiomatic React binding for an external store: every
 * component that calls the hook re-renders when the runtime state changes, REGARDLESS of whether
 * the provider subtree re-renders. (A naive "provider forceUpdate" does NOT work here — React bails
 * out of re-rendering `{children}` when the element reference is stable, so pages would freeze on
 * their first snapshot. See the unlock regression this replaced.)
 */
const WalletRuntimeContext = createContext<WalletRuntime | null>(null);

export function WalletRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtimeRef = useRef<WalletRuntime | null>(null);
  if (runtimeRef.current === null) {
    // Lazy init: the registry is loaded in a client effect (below), so server/prerender output
    // is deterministic and hydration never reads localStorage during render.
    runtimeRef.current = new WalletRuntime({ lazy: true });
  }
  useEffect(() => {
    runtimeRef.current?.init();
  }, []);
  return <WalletRuntimeContext.Provider value={runtimeRef.current}>{children}</WalletRuntimeContext.Provider>;
}

export interface WalletRuntimeApi {
  /** The runtime instance — the only custody boundary the UI talks to. */
  runtime: WalletRuntime;
  /** The current safe UI-facing snapshot (fresh, reactive). Never contains secrets. */
  state: WalletRuntimeView;
}

export function useWalletRuntime(): WalletRuntimeApi {
  const runtime = useContext(WalletRuntimeContext);
  if (!runtime) {
    throw new Error("useWalletRuntime must be used within a WalletRuntimeProvider.");
  }
  const subscribe = useCallback((onStoreChange: () => void) => runtime.subscribe(onStoreChange), [runtime]);
  const getSnapshot = useCallback(() => runtime.getState(), [runtime]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { runtime, state };
}
