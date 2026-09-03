"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CallData } from "starknet";
import {
  createWallet,
  unlockWallet,
  deployAccount,
  getDeploymentStatus,
  sendTransaction,
  exportSecret,
  clearWallet,
  lockWallet,
  parseAmountToBase,
  isReadyAccountSupported,
  defaultStorage,
  readPublicState,
  type UnlockedWallet,
  type WalletNetworkId,
} from "@/wallet";
import { getNetworkConfig } from "@/config/networks";

type View = "create" | "unlock" | "wallet";

function shortAddr(value: string | null): string {
  if (!value) return "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export default function OwnWalletPage() {
  const [network, setNetwork] = useState<WalletNetworkId>("sepolia");
  const [view, setView] = useState<View>("create");
  const [password, setPassword] = useState("");
  const [wallet, setWallet] = useState<UnlockedWallet | null>(null);
  const [status, setStatus] = useState<string>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Export / recovery is an explicit, warning-gated flow — never a generic banner.
  const [exportStage, setExportStage] = useState<"idle" | "confirm" | "revealed">("idle");
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  // Recipient + amount for the single test transaction flow.
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");

  const storage = defaultStorage();

  // Decide create vs unlock from persisted public state.
  useEffect(() => {
    const state = readPublicState(storage, network);
    setView(state ? "unlock" : "create");
    setWallet(null);
    setError(null);
    setNotice(null);
    setExportStage("idle");
    setRevealedSecret(null);
  }, [network]);

  const handleCreate = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const w = await createWallet({ network, password });
      setWallet(w);
      setView("wallet");
      setStatus("not_deployed");
      setNotice("Wallet created. Keys are stored in an encrypted keystore protected by your password.");
      void getDeploymentStatus(w).then(setStatus).catch(() => setStatus("unknown"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet creation failed.");
    } finally {
      setBusy(false);
    }
  }, [network, password]);

  const handleUnlock = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const w = await unlockWallet({ network, password });
      setWallet(w);
      setView("wallet");
      void getDeploymentStatus(w).then(setStatus).catch(() => setStatus("unknown"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed — wrong password?");
    } finally {
      setBusy(false);
    }
  }, [network, password]);

  const handleDeploy = useCallback(async () => {
    if (!wallet) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setStatus("pending");
      const result = await deployAccount(wallet);
      setStatus("deployed");
      setNotice(
        result.transactionHash
          ? `Account deployed: ${result.transactionHash}`
          : "Account was already deployed.",
      );
    } catch (err) {
      setStatus("unknown");
      setError(
        err instanceof Error
          ? `Deployment failed: ${err.message}`
          : "Deployment failed.",
      );
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  const handleSend = useCallback(async () => {
    if (!wallet) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const strk = getNetworkConfig(network).tokens.find((t) => t.symbol === "STRK");
      if (!strk) throw new Error("STRK token is not configured for this network.");
      // Exact decimal → base-unit conversion. Never float math for money.
      const amountBase = parseAmountToBase(amount, strk.decimals);
      if (amountBase <= 0n) throw new Error("Amount must be greater than zero.");
      const call = {
        contractAddress: strk.address,
        entrypoint: "transfer",
        calldata: CallData.compile({ recipient, amount: amountBase }),
      };
      const { transactionHash } = await sendTransaction(wallet, call);
      setNotice(`Transaction submitted locally-signed: ${transactionHash}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }, [wallet, network, recipient, amount]);

  // Export flow: first click → confirm warning; second (Reveal) → decrypt with password.
  const handleExportStart = useCallback(() => {
    setError(null);
    setRevealedSecret(null);
    setExportStage("confirm");
  }, []);

  const handleExportReveal = useCallback(async () => {
    if (!wallet) return;
    setError(null);
    try {
      const secret = await exportSecret(wallet, password);
      setRevealedSecret(secret);
      setExportStage("revealed");
    } catch {
      setError("Password did not match this wallet.");
    }
  }, [wallet, password]);

  const handleExportCancel = useCallback(() => {
    setExportStage("idle");
    setRevealedSecret(null);
  }, []);

  const handleLock = useCallback(() => {
    if (wallet) lockWallet(wallet);
    setWallet(null);
    setPassword("");
    setNotice("Wallet locked. Unlock with your password to sign again.");
    setExportStage("idle");
    setRevealedSecret(null);
    setView("unlock");
  }, [wallet]);

  const handleDelete = useCallback(() => {
    clearWallet(network, storage);
    setWallet(null);
    setPassword("");
    setView("create");
    setNotice("Local wallet state removed.");
  }, [network, storage]);

  return (
    <main className="min-h-screen bg-background text-zinc-100 p-6 flex justify-center">
      <div className="w-full max-w-2xl">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest text-orange-500">Stage 1 · Own Wallet Core</p>
          <h1 className="text-2xl font-semibold mt-1">Self-custodial Starknet wallet</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Local key generation → encrypted keystore → Ready account → local signer. No Privy, no
            external wallet, no server-side signing.
          </p>
        </header>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">Network</span>
            {(["sepolia", "mainnet"] as const).map((n) => {
              const supported = isReadyAccountSupported(n);
              return (
                <button
                  key={n}
                  onClick={() => supported && setNetwork(n)}
                  disabled={!supported}
                  title={supported ? undefined : "Ready account not verified on this network yet"}
                  className={`px-3 py-1 rounded-md text-sm border ${
                    network === n
                      ? "border-orange-500 text-orange-400"
                      : supported
                        ? "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                        : "border-zinc-800 text-zinc-600 opacity-50 cursor-not-allowed"
                  }`}
                >
                  {n}
                </button>
              );
            })}
            {network === "mainnet" && (
              <span className="text-xs text-amber-500">Ready account not verified on Mainnet — disabled.</span>
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-sm p-3 mb-4 break-all">
            {notice}
          </div>
        )}

        {view === "create" && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="font-medium mb-3">Create wallet</h2>
            <label className="block text-sm text-zinc-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4"
            />
            <button
              onClick={handleCreate}
              disabled={busy || password.length < 8}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create wallet"}
            </button>
            <p className="text-xs text-zinc-500 mt-3">
              Generates a STARK signing key locally, derives your Ready account address, and
              encrypts the key with your password (AES-GCM + PBKDF2). Nothing is sent anywhere.
            </p>
          </section>
        )}

        {view === "unlock" && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="font-medium mb-3">Unlock wallet</h2>
            <label className="block text-sm text-zinc-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4"
            />
            <button
              onClick={handleUnlock}
              disabled={busy || !password}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </section>
        )}

        {view === "wallet" && wallet && (
          <>
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 mb-4">
              <h2 className="font-medium mb-3">Wallet state</h2>
              <dl className="space-y-2 text-sm">
                <Row label="Account type" value={wallet.accountType} />
                <Row label="Address" value={shortAddr(wallet.address)} />
                <Row label="Full address" value={wallet.address} mono />
                <Row label="Public key" value={shortAddr(wallet.publicKey)} />
                <Row label="Network" value={wallet.network} />
                <Row label="Deployment" value={status} />
              </dl>
              <div className="mt-4 flex gap-2 flex-wrap">
                <button
                  onClick={handleDeploy}
                  disabled={busy || status === "deployed"}
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
                >
                  {status === "deployed" ? "Deployed" : busy ? "Deploying…" : "Deploy account"}
                </button>
                <button
                  onClick={handleExportStart}
                  disabled={busy}
                  className="rounded-md border border-amber-700 px-3 py-2 text-sm text-amber-300"
                >
                  Export recovery secret
                </button>
                <button onClick={handleLock} disabled={busy} className="rounded-md border border-zinc-700 px-3 py-2 text-sm">
                  Lock
                </button>
                <button onClick={handleDelete} disabled={busy} className="rounded-md border border-red-900 px-3 py-2 text-sm text-red-300">
                  Delete local state
                </button>
              </div>

              {exportStage === "confirm" && (
                <div className="mt-4 rounded-md border border-amber-800 bg-amber-950/30 p-4">
                  <h3 className="text-sm font-medium text-amber-300 mb-2">Export recovery secret?</h3>
                  <p className="text-xs text-amber-200/80 mb-3">
                    This reveals your raw signing key. <strong>Anyone with it controls the
                    account.</strong> Store it offline and never share it. You will need your
                    password to reveal it.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportReveal}
                      disabled={busy || !password}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                    >
                      Reveal secret
                    </button>
                    <button
                      onClick={handleExportCancel}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {exportStage === "revealed" && revealedSecret && (
                <div className="mt-4 rounded-md border border-red-900 bg-red-950/30 p-4">
                  <h3 className="text-sm font-medium text-red-300 mb-2">Recovery secret (handle with care)</h3>
                  <p className="text-xs text-red-200/80 mb-2">
                    Copy it now and store it offline. Do not paste it into chats, support tickets,
                    or any website.
                  </p>
                  <pre className="font-mono text-xs bg-black/40 rounded p-3 break-all whitespace-pre-wrap border border-red-900/50">
                    {revealedSecret}
                  </pre>
                  <button
                    onClick={handleExportCancel}
                    className="mt-3 rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
                  >
                    Hide
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="font-medium mb-3">Transaction (locally signed)</h2>
              <label className="block text-sm text-zinc-400 mb-1">Recipient</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
              />
              <label className="block text-sm text-zinc-400 mb-1">Amount (STRK)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4"
              />
              <button
                onClick={handleSend}
                disabled={busy || !recipient || !amount}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              >
                {busy ? "Signing & submitting…" : "Send STRK"}
              </button>
              <p className="text-xs text-zinc-500 mt-3">
                Signs with the wallet&apos;s local key via starknet.js — the transaction hash is
                produced locally and submitted to the network. Requires a deployed + funded account.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-zinc-500">{label}</dt>
      <dd className={`text-zinc-200 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}