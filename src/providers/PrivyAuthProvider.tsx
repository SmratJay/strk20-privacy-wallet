"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";

export const PrivyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;

  // Starknet (Tier 2) wallets are created server-side via /api/privy/wallet, not on login,
  // so no createOnLogin is configured here.
  return (
    <PrivyProvider appId={appId} config={{ embeddedWallets: { showWalletUIs: false } }}>
      {children}
    </PrivyProvider>
  );
};