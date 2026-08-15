'use client';

import React, { useState } from 'react';
import { QrCode, Copy, Check, Share2, Sparkles, UserCheck, ShieldCheck, ArrowRight } from 'lucide-react';
import { MAINNET_TOKENS, TokenInfo } from '@/config/tokens';
import { shortenAddress } from '@/utils/formatters';
import { useToast } from '@/components/Toast';

interface RequestTabProps {
  wallet: any;
}

export const RequestTab: React.FC<RequestTabProps> = ({ wallet }) => {
  const { showToast } = useToast();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(MAINNET_TOKENS[0]);
  const [amount, setAmount] = useState('25');
  const [memo, setMemo] = useState('Payment for Dev Services');
  const [copied, setCopied] = useState(false);

  const privacyReceiveAddress = wallet.address ? `strk20:${wallet.address}` : 'strk20:0x0471...938d';
  const paymentLink = `https://orrange.xyz/pay/${privacyReceiveAddress}?token=${selectedToken.symbol}&amount=${amount}&memo=${encodeURIComponent(memo)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    showToast({
      type: 'success',
      title: 'Stealth Link Copied',
      description: 'Share this link with anyone to receive private payment',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400" />
          <span>Stealth Payment Request (Invoice)</span>
        </h2>
        <p className="text-xs text-zinc-400">
          Generate an invoice with custom amount. Anyone paying deposits directly into your encrypted pool notes.
        </p>
      </div>

      <div className="space-y-4">
        {/* Asset & Amount Configuration */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Requested Asset & Amount</span>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = MAINNET_TOKENS.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2.5 outline-none"
            >
              {MAINNET_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>

            <input
              type="number"
              step="any"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-surface border border-surface-border text-white text-base font-mono rounded-xl px-3 py-2 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-zinc-400">Payment Memo / Reason (Private)</label>
            <input
              type="text"
              placeholder="e.g. Freelance Invoice #102, Bounty Reward"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full mt-1 bg-surface border border-surface-border text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Live Generated Payment Card & QR Preview */}
        <div className="p-5 rounded-xl bg-gradient-to-br from-surface-elevated via-surface to-emerald-950/20 border border-emerald-500/30 text-center space-y-3">
          <div className="inline-block p-3 rounded-2xl bg-white shadow-xl border-2 border-emerald-500/40">
            <svg className="w-36 h-36" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="100" height="100" fill="white"/>
              <rect x="10" y="10" width="24" height="24" fill="black"/>
              <rect x="14" y="14" width="16" height="16" fill="white"/>
              <rect x="18" y="18" width="8" height="8" fill="black"/>
              <rect x="66" y="10" width="24" height="24" fill="black"/>
              <rect x="70" y="14" width="16" height="16" fill="white"/>
              <rect x="74" y="18" width="8" height="8" fill="black"/>
              <rect x="10" y="66" width="24" height="24" fill="black"/>
              <rect x="14" y="70" width="16" height="16" fill="white"/>
              <rect x="18" y="74" width="8" height="8" fill="black"/>
              <rect x="40" y="12" width="6" height="6" fill="black"/>
              <rect x="52" y="18" width="6" height="6" fill="black"/>
              <rect x="44" y="44" width="12" height="12" fill="#10b981"/>
              <rect x="62" y="44" width="6" height="6" fill="black"/>
              <rect x="76" y="52" width="8" height="8" fill="black"/>
              <rect x="40" y="70" width="8" height="8" fill="black"/>
              <rect x="80" y="80" width="8" height="8" fill="black"/>
            </svg>
          </div>

          <div>
            <div className="text-sm font-bold text-white font-mono">
              Requesting {amount || '0'} {selectedToken.symbol}
            </div>
            {memo && <div className="text-xs text-emerald-400 font-mono mt-0.5">"{memo}"</div>}
            <div className="text-[11px] text-zinc-500 font-mono mt-1 break-all">
              To: {shortenAddress(privacyReceiveAddress, 8)}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={handleCopyLink}
              className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 transition-all"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Link Copied!' : 'Copy Stealth Link'}</span>
            </button>

            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: 'STRK20 Stealth Invoice', url: paymentLink });
                } else {
                  handleCopyLink();
                }
              }}
              className="py-2.5 px-3 rounded-xl bg-surface-elevated hover:bg-surface-border text-zinc-200 border border-surface-border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
            >
              <Share2 className="w-4 h-4 text-emerald-400" />
              <span>Share Invoice</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
