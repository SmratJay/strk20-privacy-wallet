"use client";

import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import { WalletRuntime } from "@/wallet/runtime";

/**
 * Wallet Runtime — the primary Orrange wallet runtime (Wallet Core backed, NO Privy).
 *
 * This is the custody boundary the product UI talks to. It is intentionally independent of the
 * legacy `WalletContext` / `PrivyWalletContext` runtimes, which remain for legacy/compatibility
 * pages. An unlocked Wallet Core session is in-memory only and never persisted — a page reload
 * returns to "wallet exists → locked".
 */
const WalletRuntimeContext = createContext<WalletRuntime | null>(null);

export function WalletRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtimeRef = useRef<WalletRuntime | null>(null);
  if (runtimeRef.current === null) {
    // Lazy init: the registry is loaded in a client effect (below), so server/prerender output
    // is deterministic and hydration never reads localStorage during render.
    runtimeRef.current = new WalletRuntime({ lazy: true });
  }
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const unsubscribe = runtime.subscribe(() => forceUpdate());
    runtime.init();
    return unsubscribe;
  }, []);
  return <WalletRuntimeContext.Provider value={runtimeRef.current}>{children}</WalletRuntimeContext.Provider>;
}

export function useWalletRuntime(): WalletRuntime {
  const runtime = useContext(WalletRuntimeContext);
  if (!runtime) {
    throw new Error("useWalletRuntime must be used within a WalletRuntimeProvider.");
  }
  return runtime;
}