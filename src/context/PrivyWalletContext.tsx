"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Account, RpcProvider, constants } from "starknet";
import { usePrivy } from "@privy-io/react-auth";
import { StarknetAccountAdapter, fetchSigningClient } from "@/privacy/privy";
import { computeReadyAccountAddress } from "@/privacy/privy/ready";
import { PrivyStrk20Adapter, type Strk20ExecuteReceipt } from "@/privacy/adapter";
import { loadOrCreateViewingKey } from "@/privacy/privy/viewingKeyStore";
import { getNetworkConfig } from "@/config/networks";
import { waitForStrk20Confirmation } from "@/services/strk20WalletApiService";

const SEPOLIA_POOL =
  process.env.NEXT_PUBLIC_STRK20_SEPOLIA_POOL ||
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const PROVER_URL = process.env.NEXT_PUBLIC_STRK20_PROVER_URL || "";
const DISCOVERY_URL = process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL || "";

interface ResolvedWallet {
  id: string;
  address: string;
  publicKey: string;
}

export interface PrivyWalletContextValue {
  isAvailable: boolean;
  ready: boolean;
  authenticated: boolean;
  isConnecting: boolean;
  error: string | null;
  address: string | null;
  account: Account | null;
  viewingKey: bigint | null;
  login: (opts?: { email?: string; google?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  shield: (token: string, amountBase: bigint) => Promise<Strk20ExecuteReceipt>;
  unshield: (token: string, amountBase: bigint, recipient: string) => Promise<Strk20ExecuteReceipt>;
  transfer: (token: string, amountBase: bigint, recipient: string) => Promise<Strk20ExecuteReceipt>;
  register: () => Promise<Strk20ExecuteReceipt>;
  getPrivateBalance: (token: string) => Promise<bigint>;
}

const UNAVAILABLE: PrivyWalletContextValue = {
  isAvailable: false,
  ready: false,
  authenticated: false,
  isConnecting: false,
  error: null,
  address: null,
  account: null,
  viewingKey: null,
  login: async () => {},
  logout: async () => {},
  shield: async () => { throw new Error("Privy is not configured."); },
  unshield: async () => { throw new Error("Privy is not configured."); },
  transfer: async () => { throw new Error("Privy is not configured."); },
  register: async () => { throw new Error("Privy is not configured."); },
  getPrivateBalance: async () => { throw new Error("Privy is not configured."); },
};

const PrivyWalletContext = createContext<PrivyWalletContextValue>(UNAVAILABLE);

async function resolveStarknetWallet(userId: string, token: string): Promise<ResolvedWallet> {
  const cacheKey = `pel_privy_wallet_${userId.toLowerCase()}`;

  try {
    const cached = typeof localStorage !== "undefined" ? localStorage.getItem(cacheKey) : null;
    if (cached) {
      const parsed = JSON.parse(cached) as ResolvedWallet;
      if (parsed.id && parsed.address && parsed.publicKey) return parsed;
    }
  } catch {
    // Ignore corrupt cache; fall through to create.
  }

  const res = await fetch("/api/privy/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to resolve Privy Starknet wallet (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { wallet?: { id?: unknown; publicKey?: unknown } };
  const wallet = json?.wallet;
  if (!wallet || typeof wallet.id !== "string") {
    throw new Error("Privy Starknet wallet response missing id.");
  }
  const publicKey = typeof wallet.publicKey === "string" ? wallet.publicKey : "";
  if (!publicKey) throw new Error("Privy Starknet wallet response missing public key.");
  // The real on-chain account is the DERIVED Ready address (NOT Privy wallet.address).
  const address = computeReadyAccountAddress(publicKey);
  const result: ResolvedWallet = { id: wallet.id, address, publicKey };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch {
    // Cache write is best-effort.
  }
  return result;
}

function buildAdapter(): PrivyStrk20Adapter {
  return new PrivyStrk20Adapter({
    poolContractAddress: SEPOLIA_POOL,
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    proverUrl: PROVER_URL,
    discoveryUrl: DISCOVERY_URL,
  });
}

const PrivyWalletInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { ready, authenticated, user, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{
    walletId: string;
    address: string;
    account: Account;
    viewingKey: bigint;
  } | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Privy access token unavailable.");
        const wallet = await resolveStarknetWallet(user.id, token);
        const signingClient = fetchSigningClient("/api/privy/sign", () => getAccessToken());
        const provider = new RpcProvider({ nodeUrl: getNetworkConfig("sepolia").rpcUrls[0] });
        const account = StarknetAccountAdapter.create({
          address: wallet.address,
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          client: signingClient,
          provider,
        });
        const viewingKey = await loadOrCreateViewingKey(user.id, wallet.id, signingClient);
        if (!cancelled) {
          setResolved({ walletId: wallet.id, address: wallet.address, account, viewingKey });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Privy wallet setup failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user?.id, getAccessToken]);

  const login = useCallback(
    async (opts?: { email?: string; google?: boolean }) => {
      setError(null);
      setIsConnecting(true);
      try {
        if (opts?.google) {
          privyLogin({ loginMethods: ["google"] });
        } else if (opts?.email) {
          privyLogin({ prefill: { type: "email", value: opts.email } });
        } else {
          privyLogin();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Privy login failed.");
      } finally {
        setIsConnecting(false);
      }
    },
    [privyLogin],
  );

  const logout = useCallback(async () => {
    setResolved(null);
    await privyLogout();
  }, [privyLogout]);

  const requireReady = useCallback((): { account: Account; address: string; viewingKey: bigint } => {
    if (!resolved) throw new Error("Privy wallet is not ready. Connect first.");
    return { account: resolved.account, address: resolved.address, viewingKey: resolved.viewingKey };
  }, [resolved]);

  const shield = useCallback(
    async (token: string, amountBase: bigint) => {
      const user = requireReady();
      return buildAdapter().shield(user, token, amountBase);
    },
    [requireReady],
  );

  const unshield = useCallback(
    async (token: string, amountBase: bigint, recipient: string) => {
      const user = requireReady();
      return buildAdapter().unshield(user, token, amountBase);
    },
    [requireReady],
  );

  const transfer = useCallback(
    async (token: string, amountBase: bigint, recipient: string) => {
      const user = requireReady();
      return buildAdapter().transfer(user, token, amountBase, recipient);
    },
    [requireReady],
  );

  const register = useCallback(async () => {
    const user = requireReady();
    return buildAdapter().register(user);
  }, [requireReady]);

  const getPrivateBalance = useCallback(
    async (token: string) => {
      const user = requireReady();
      return buildAdapter().getPrivateBalance(user, token);
    },
    [requireReady],
  );

  const value = useMemo<PrivyWalletContextValue>(
    () => ({
      isAvailable: true,
      ready,
      authenticated,
      isConnecting,
      error,
      address: resolved?.address ?? null,
      account: resolved?.account ?? null,
      viewingKey: resolved?.viewingKey ?? null,
      login,
      logout,
      shield,
      unshield,
      transfer,
      register,
      getPrivateBalance,
    }),
    [ready, authenticated, isConnecting, error, resolved, login, logout, shield, unshield, transfer, register, getPrivateBalance],
  );

  return <PrivyWalletContext.Provider value={value}>{children}</PrivyWalletContext.Provider>;
};

export const PrivyWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <PrivyWalletContext.Provider value={UNAVAILABLE}>{children}</PrivyWalletContext.Provider>;
  return <PrivyWalletInner>{children}</PrivyWalletInner>;
};

export const usePrivyWallet = (): PrivyWalletContextValue => useContext(PrivyWalletContext);

export { waitForStrk20Confirmation };
