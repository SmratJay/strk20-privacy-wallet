// Ambient structural declarations for Privy client SDK. Remove once the real
// packages (with their own types) are installed via `npm install`.

declare module "@privy-io/react-auth" {
  export interface PrivyUser {
    id: string;
    email?: { address?: string } | null;
    wallet?: { address?: string } | null;
  }

  export interface PrivyProviderConfig {
    embeddedWallets?: { createOnLogin?: string; showWalletUIs?: boolean };
    loginMethods?: string[];
  }

  export function PrivyProvider(props: {
    appId: string;
    config?: PrivyProviderConfig;
    children?: any;
  }): any;

  export function usePrivy(): {
    ready: boolean;
    authenticated: boolean;
    user: PrivyUser | null;
    login(options?: { email?: string; loginMethod?: string; loginMethods?: string[] }): Promise<void>;
    logout(): Promise<void>;
    getAccessToken(): Promise<string | null>;
  };

  export function useWallets(): { ready: boolean; wallets: unknown[] };
}
