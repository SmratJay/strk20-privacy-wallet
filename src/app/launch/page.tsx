'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CallData, shortString } from 'starknet';
import { Loader2, Rocket, Globe, Shield, CheckCircle2, X } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import { getLaunchNetwork, CREATE_DEFAULTS } from '@/config/launch';
import { providerFor, launchMetadataRef, normalizeAddress } from '@/services/launchService';

const MAX_SHORT_STRING = 31; // felt short-string limit

type Step = 'SIGNING' | 'CONFIRMING' | 'REGISTERING' | 'DONE';

export default function LaunchCreatePage() {
  const router = useRouter();
  const { wallet, networkId, isSepolia } = useWallet();

  const net = getLaunchNetwork(networkId);
  const factoryConfigured = Boolean(net.factory);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [socialX, setSocialX] = useState('');
  const [socialTelegram, setSocialTelegram] = useState('');
  const [socialWebsite, setSocialWebsite] = useState('');

  const [step, setStep] = useState<Step | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const connected = wallet.isConnected;

  const validate = (): string | null => {
    const n = name.trim();
    const s = symbol.trim();
    if (!n) return 'Give your coin a name.';
    if (n.length > MAX_SHORT_STRING) return `Coin name must be ${MAX_SHORT_STRING} characters or fewer (on-chain short string).`;
    if (!s) return 'Give your coin a ticker.';
    if (s.length > MAX_SHORT_STRING) return `Ticker must be ${MAX_SHORT_STRING} characters or fewer.`;
    if (!/^[A-Za-z0-9_]+$/.test(s)) return 'Ticker may only contain letters, numbers and underscores.';
    return null;
  };

  const launch = async () => {
    setFieldError(null);
    setError(null);
    setTxHash(null);
    setNewToken(null);

    if (!connected || !wallet.address) {
      setError('Connect a Starknet wallet to launch a coin.');
      return;
    }
    if (!isSepolia) {
      setError('Launch is currently Starknet Sepolia only. Switch your wallet to Sepolia.');
      return;
    }
    if (!factoryConfigured) {
      setError('The ORRANGE TokenFactory is not deployed/configured for Sepolia yet.');
      return;
    }
    const v = validate();
    if (v) {
      setFieldError(v);
      return;
    }
    const account = wallet.walletAccount;
    if (!account || typeof account.execute !== 'function') {
      setError('Connected wallet does not support contract execution.');
      return;
    }

    try {
      setStep('SIGNING');
      const calldata = CallData.compile({
        name: shortString.encodeShortString(name.trim()),
        symbol: shortString.encodeShortString(symbol.trim()),
        decimals: CREATE_DEFAULTS.decimals,
        metadata_uri: shortString.encodeShortString(launchMetadataRef()),
        total_supply: BigInt(CREATE_DEFAULTS.totalSupply),
        virtual_base_reserve: BigInt(CREATE_DEFAULTS.virtualBase),
        virtual_token_reserve: BigInt(CREATE_DEFAULTS.virtualToken),
        graduation_target: BigInt(CREATE_DEFAULTS.graduationTarget),
        fee_bps: Number(CREATE_DEFAULTS.feeBps),
      });
      const res = await account.execute([
        { contractAddress: net.factory, entrypoint: 'create_memecoin', calldata },
      ]);
      const hash = res.transaction_hash ?? res.transactionHash ?? res.hash;
      setTxHash(hash);

      setStep('CONFIRMING');
      const provider = providerFor(networkId);
      await provider.waitForTransaction(hash);

      setStep('REGISTERING');
      const countRes = await provider.callContract({
        contractAddress: net.factory,
        entrypoint: 'get_token_count',
        calldata: [],
      });
      const count = Number(countRes[0] ?? 0);
      const id = count - 1;
      const tokenRes = await provider.callContract({
        contractAddress: net.factory,
        entrypoint: 'get_token',
        calldata: [String(id)],
      });
      const token = normalizeAddress(tokenRes[0] ?? '');

      // Best-effort off-chain enrichment (description / image / socials). The token is
      // already on-chain and discoverable; metadata registration is additive.
      try {
        await fetch('/api/launch/metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            description,
            image,
            socials: { x: socialX, telegram: socialTelegram, website: socialWebsite },
          }),
        });
      } catch {
        // Non-fatal: the coin is live on-chain regardless.
      }

      setStep('DONE');
      setNewToken(token);
    } catch (e: any) {
      setError(e?.message || 'Launch failed. Check your wallet and try again.');
      setStep(null);
    }
  };

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / LAUNCH</div>
            <h1 className="product-page-title flex items-center gap-2">
              <Rocket className="w-5 h-5 text-violet-400" /> Launch a coin
            </h1>
            <p className="product-page-description">
              Deploy a memecoin on Starknet Sepolia with a bonded curve.{' '}
              <span className="text-violet-300">One transaction. Instantly tradable. Instantly discoverable.</span>
            </p>
            {isSepolia && factoryConfigured && (
              <p className="text-[12px] text-emerald-300 mt-1">
                Factory live · launching through <span className="font-mono">{net.factory.slice(0, 14)}…</span>
              </p>
            )}
          </div>
          <Link href="/explore" className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 hover:border-violet-500/40 text-zinc-300 hover:text-zinc-100 text-[13px] font-semibold px-4 py-2.5 transition-colors">
            <Globe className="w-4 h-4" /> Explore launched coins
          </Link>
        </div>

        {!connected ? (
          <ConnectGate />
        ) : !isSepolia ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-amber-300">
            Launch is Starknet <strong>Sepolia</strong> only for now. Switch your wallet to the
            Sepolia network to create a coin.
          </div>
        ) : !factoryConfigured ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-amber-300">
            The ORRANGE TokenFactory is not configured for Sepolia yet. Set{' '}
            <code className="text-amber-200 font-mono">NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY</code> and{' '}
            <code className="text-amber-200 font-mono">NEXT_PUBLIC_UMBRA_ROUTER</code> to open the market.
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
            {/* Create form */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Coin name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_SHORT_STRING}
                  placeholder="Hampton the Hamster"
                  className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Ticker</label>
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  maxLength={MAX_SHORT_STRING}
                  placeholder="HAMSTR"
                  className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] font-mono text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What is this coin about?"
                  className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700 resize-none"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Image URL</label>
                <input
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="https://…/coin.png (optional)"
                  className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[14px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-zinc-500">X / Twitter</label>
                  <input
                    value={socialX}
                    onChange={(e) => setSocialX(e.target.value)}
                    placeholder="@handle"
                    className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-zinc-500">Telegram</label>
                  <input
                    value={socialTelegram}
                    onChange={(e) => setSocialTelegram(e.target.value)}
                    placeholder="t.me/…"
                    className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-zinc-500">Website</label>
                  <input
                    value={socialWebsite}
                    onChange={(e) => setSocialWebsite(e.target.value)}
                    placeholder="https://…"
                    className="mt-1 w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 outline-none focus:border-violet-500/50 placeholder:text-zinc-700"
                  />
                </div>
              </div>

              {fieldError && (
                <div className="flex items-start gap-2 text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2">
                  <X className="w-4 h-4 shrink-0 mt-0.5" /> {fieldError}
                </div>
              )}
              {error && (
                <div className="text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3 break-words">
                  {error}
                </div>
              )}

              <button
                onClick={() => void launch()}
                disabled={step !== null}
                className="w-full py-3.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {step === 'SIGNING' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Signing in wallet…
                  </span>
                ) : step === 'CONFIRMING' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Deploying token + curve…
                  </span>
                ) : step === 'REGISTERING' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Registering metadata…
                  </span>
                ) : step === 'DONE' ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Launched
                  </span>
                ) : (
                  'Launch Coin'
                )}
              </button>

              {txHash && (
                <div className="flex items-center justify-between text-[12px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-3 break-all">
                  <span>{txHash}</span>
                  <a
                    href={`https://sepolia.voyager.online/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 shrink-0 text-emerald-300 underline"
                  >
                    View
                  </a>
                </div>
              )}

              {newToken && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-300 space-y-2">
                  <div>
                    <strong>Coin is live!</strong> It is now discoverable on Explore and tradable on its bonded curve.
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/launch/${newToken}`}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 text-black text-[13px] font-bold px-3 py-2"
                    >
                      <Rocket className="w-4 h-4" /> Open your coin
                    </Link>
                    <Link
                      href="/explore"
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 text-emerald-200 text-[13px] font-semibold px-3 py-2"
                    >
                      <Globe className="w-4 h-4" /> Explore
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar: curve config summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Bonding curve</div>
                <ul className="mt-2 space-y-1.5 text-[12px] text-zinc-300">
                  <li className="flex justify-between"><span>Virtual base</span><span className="font-mono text-zinc-400">15 STRK</span></li>
                  <li className="flex justify-between"><span>Supply</span><span className="font-mono text-zinc-400">1.073B</span></li>
                  <li className="flex justify-between"><span>Graduation target</span><span className="font-mono text-zinc-400">50 STRK</span></li>
                  <li className="flex justify-between"><span>Fee</span><span className="font-mono text-zinc-400">1%</span></li>
                </ul>
              </div>
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
                  <Shield className="w-4 h-4 text-violet-400" /> Public market · private execution
                </div>
                <p className="mt-2 text-[12px] text-zinc-400 leading-relaxed">
                  Your token gets a real on-chain TokenFactory deployment: memecoin + bonding curve
                  + private executor, atomically. Trading on the curve is public; your wallet→trade
                  link can stay shielded through STRK20.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}