"use client";

import React from "react";
import { PrivyProvider } from "@privy-io/react-auth";

export const PrivyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
};
