'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Globe, ImagePlus, Loader2, Rocket, Shield, X } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import { CREATE_DEFAULTS, getLaunchNetwork } from '@/config/launch';
import { buildCreateCalldata, launchMetadataRef, providerFor, resolveCreatedTokenFromReceipt } from '@/services/launchService';

const MAX_SHORT_STRING = 31;
const MAX_MEDIA_BYTES = 700_000;
type Step = 'SIGNING' | 'CONFIRMING' | 'REGISTERING' | 'DONE';

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
    if (file.size > MAX_MEDIA_BYTES) return reject(new Error('Images must be 700KB or smaller.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

export default function LaunchCreatePage() {
  const { wallet, isSepolia } = useWallet();
  const net = getLaunchNetwork('sepolia');
  const factoryConfigured = Boolean(net.factory);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [banner, setBanner] = useState('');
  const [socialX, setSocialX] = useState('');
  const [socialTelegram, setSocialTelegram] = useState('');
  const [socialWebsite, setSocialWebsite] = useState('');
  const [step, setStep] = useState<Step | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const onFile = async (file: File | undefined, target: 'image' | 'banner') => {
    if (!file) return;
    try { const data = await readImage(file); target === 'image' ? setImage(data) : setBanner(data); setFieldError(null); }
    catch (e: any) { setFieldError(e?.message || 'Could not use that image.'); }
  };

  const validate = () => {
    const n = name.trim(); const s = symbol.trim();
    if (!n) return 'Give your token a name.';
    if (n.length > MAX_SHORT_STRING) return `Name must be ${MAX_SHORT_STRING} characters or fewer.`;
    if (!s) return 'Give your token a ticker.';
    if (s.length > MAX_SHORT_STRING) return `Ticker must be ${MAX_SHORT_STRING} characters or fewer.`;
    if (!/^[A-Za-z0-9_]+$/.test(s)) return 'Ticker may only contain letters, numbers and underscores.';
    return null;
  };

  const launch = async () => {
    setError(null); setFieldError(null); setTxHash(null); setNewToken(null);
    if (!wallet.isConnected || !wallet.address) return setError('Connect a Starknet wallet to launch a token.');
    if (!isSepolia) return setError('Launch is Starknet Sepolia only. Switch your wallet to Sepolia.');
    if (!factoryConfigured) return setError('The V2 TokenFactory is not configured for Sepolia.');
    const invalid = validate(); if (invalid) return setFieldError(invalid);
    const account = wallet.walletAccount;
    if (!account || typeof account.execute !== 'function') return setError('Connected wallet does not support contract execution.');
    try {
      setStep('SIGNING');
      const calldata = buildCreateCalldata({ name: name.trim(), symbol: symbol.trim(), decimals: CREATE_DEFAULTS.decimals, metadataUri: launchMetadataRef(), totalSupply: CREATE_DEFAULTS.totalSupply, virtualBase: CREATE_DEFAULTS.virtualBase, virtualToken: CREATE_DEFAULTS.virtualToken, graduationTarget: CREATE_DEFAULTS.graduationTarget, feeBps: CREATE_DEFAULTS.feeBps, creatorFeeBps: CREATE_DEFAULTS.creatorFeeBps, protocolFeeBps: CREATE_DEFAULTS.protocolFeeBps, maxTradeBps: CREATE_DEFAULTS.maxTradeBps });
      const result = await account.execute([{ contractAddress: net.factory, entrypoint: 'create_memecoin', calldata }]);
      const hash = result.transaction_hash ?? result.transactionHash ?? result.hash;
      setTxHash(hash); setStep('CONFIRMING');
      const receipt = await providerFor('sepolia').waitForTransaction(hash);
      const token = resolveCreatedTokenFromReceipt(receipt);
      if (!token) throw new Error('Launch confirmed, but the TokenCreated event could not be resolved. Refresh Explore to find it.');
      setStep('REGISTERING');
      let metadataSaved = false;
      try {
        const metadataResponse = await fetch('/api/launch/metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name: name.trim(), symbol: symbol.trim().toUpperCase(), description, image, banner, socials: { x: socialX, telegram: socialTelegram, website: socialWebsite } }) });
        metadataSaved = metadataResponse.ok;
      } catch { metadataSaved = false; }
      setNewToken(token); setStep('DONE');
      if (!metadataSaved) setError('Token launched, but metadata could not be saved. It is still tradable on Explore.');
    } catch (e: any) { setError(e?.message || 'Launch failed. Check your wallet and try again.'); setStep(null); }
  };

  const inputClass = 'mt-1 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-orange-300/70';
  return <AppShell>
    <div className="product-page launchpad-shell">
      <div className="launchpad-feed-header"><div><div className="product-eyebrow">ORRANGE / CREATE · SEPOLIA</div><h1 className="product-page-title"><Rocket className="h-5 w-5 text-orange-300" /> Launch a token</h1><p className="product-page-description">Create a real V2 curve, add your story, and show up in the live feed.</p></div><Link href="/explore" className="launch-secondary-button"><Globe className="h-4 w-4" /> Explore</Link></div>
      {!wallet.isConnected ? <ConnectGate /> : !isSepolia ? <div className="launch-alert launch-alert-warning">Switch your wallet to Starknet <strong>Sepolia</strong> to launch.</div> : !factoryConfigured ? <div className="launch-alert launch-alert-warning">V2 TokenFactory is not configured for Sepolia.</div> : <div className="launch-create-grid">
        <div className="launch-panel launch-create-form">
          <div className="launch-panel-heading"><div><span className="launch-kicker">01 / TOKEN DETAILS</span><h2>Make it yours.</h2></div><span className="launch-network-pill">V2 · SEPOLIA</span></div>
          <label>Coin name<input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_SHORT_STRING} placeholder="Something people remember" /></label>
          <label>Ticker<input className={`${inputClass} font-mono`} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} maxLength={MAX_SHORT_STRING} placeholder="ORNG" /></label>
          <label>Description<textarea className={`${inputClass} resize-none`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is the community building?" /></label>
          <div className="launch-upload-grid"><label className="launch-upload">Token image<input type="file" accept="image/*" onChange={(e) => void onFile(e.target.files?.[0], 'image')} />{image ? <img src={image} alt="Token preview" /> : <span><ImagePlus className="h-5 w-5" /> Upload square image</span>}</label><label className="launch-upload launch-upload-wide">Banner / hero<input type="file" accept="image/*" onChange={(e) => void onFile(e.target.files?.[0], 'banner')} />{banner ? <img src={banner} alt="Banner preview" /> : <span><ImagePlus className="h-5 w-5" /> Upload wide image</span>}</label></div>
          <div className="launch-url-hint">You can also paste hosted image URLs below if your media is already online.</div>
          <label>Token image URL<input className={inputClass} value={image.startsWith('data:') ? '' : image} onChange={(e) => setImage(e.target.value)} placeholder="https://… (optional)" /></label>
          <label>Banner URL<input className={inputClass} value={banner.startsWith('data:') ? '' : banner} onChange={(e) => setBanner(e.target.value)} placeholder="https://… (optional)" /></label>
          <div className="grid gap-2 sm:grid-cols-3"><label>X<input className={inputClass} value={socialX} onChange={(e) => setSocialX(e.target.value)} placeholder="@handle" /></label><label>Telegram<input className={inputClass} value={socialTelegram} onChange={(e) => setSocialTelegram(e.target.value)} placeholder="t.me/…" /></label><label>Website<input className={inputClass} value={socialWebsite} onChange={(e) => setSocialWebsite(e.target.value)} placeholder="https://…" /></label></div>
          {fieldError && <div className="launch-alert launch-alert-error"><X className="h-4 w-4" /> {fieldError}</div>}{error && <div className="launch-alert launch-alert-error">{error}</div>}
          <button onClick={() => void launch()} disabled={step !== null} className="launch-primary-button launch-create-cta">{step === 'SIGNING' ? <><Loader2 className="h-4 w-4 animate-spin" /> Sign in wallet…</> : step === 'CONFIRMING' ? <><Loader2 className="h-4 w-4 animate-spin" /> Deploying V2 curve…</> : step === 'REGISTERING' ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving metadata…</> : step === 'DONE' ? <><CheckCircle2 className="h-4 w-4" /> Launched</> : 'Launch token'}</button>
          {txHash && <a className="launch-tx-link" href={`https://sepolia.voyager.online/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
          {newToken && <div className="launch-alert launch-alert-success"><div><strong>{name || 'Your token'} is live.</strong><br />It is now in the real Sepolia feed.</div><Link href={`/launch/${newToken}`}>Open token ↗</Link></div>}
        </div>
        <aside className="launch-create-sidebar"><div className="launch-preview-panel"><span className="launch-kicker">LIVE PREVIEW</span><div className="launch-preview-media" style={banner ? { backgroundImage: `url(${banner})` } : undefined}><div className="launch-preview-shade" /><div className="launch-preview-avatar">{image ? <img src={image} alt="" /> : '🍊'}</div></div><div className="launch-preview-copy"><strong>{symbol || 'TICKER'}</strong><span>{name || 'Your token name'}</span><p>{description || 'Your description appears here.'}</p></div></div><div className="launch-panel launch-config-panel"><span className="launch-kicker">V2 CURVE</span><h3>Live from first trade.</h3><p>1B supply · 30 STRK virtual base · 120 STRK graduation target · 1% total fee.</p><div className="launch-private-callout"><Shield className="h-4 w-4" /><span>Public market, optional private execution through STRK20.</span></div></div></aside>
      </div>}
    </div>
  </AppShell>;
}
