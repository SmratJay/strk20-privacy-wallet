'use client';

import React, { useState, useEffect } from 'react';
import { Copy, Check, Share2, Sparkles } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { TokenInfo } from '@/config/tokens';
import { shortenAddress } from '@/utils/formatters';
import { useToast } from '@/components/Toast';
import { useNetwork } from '@/context/NetworkContext';

interface RequestTabProps {
  wallet: any;
}

export const RequestTab: React.FC<RequestTabProps> = ({ wallet }) => {
  const { showToast } = useToast();
  const { currentNetwork, isSepolia } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [amount, setAmount] = useState('25');
  const [memo, setMemo] = useState('Payment for Dev Services');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const matching = currentNetwork.tokens.find(t => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const privacyReceiveAddress = wallet.address ? `strk20:${wallet.address}` : 'strk20:0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const paymentLink = `https://orrange.xyz/pay/${privacyReceiveAddress}?token=${selectedToken.symbol}&amount=${amount}&network=${currentNetwork.id}&memo=${encodeURIComponent(memo)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    showToast({
      type: 'success',
      title: 'Stealth Link Copied',
      description: `Share this link with anyone to receive private payment on ${currentNetwork.name}`,
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
          Generate a dynamic QR invoice on {currentNetwork.name}. Payments deposit directly into your STRK20 encrypted channel.
        </p>
      </div>

      <div className="space-y-4">
        {/* Asset & Amount Configuration */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Requested Asset & Amount</span>
            {isSepolia && <span className="text-[11px] text-amber-400 font-mono">🧪 Sepolia Testnet</span>}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2.5 outline-none"
            >
              {currentNetwork.tokens.map((t) => (
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

        {/* Live Generated Real QR Invoice */}
        <div className="p-5 rounded-xl bg-gradient-to-br from-surface-elevated via-surface to-emerald-950/20 border border-emerald-500/30 text-center space-y-3">
          <div className="inline-block p-3 rounded-2xl bg-white shadow-xl border-2 border-emerald-500/40">
            <QRCodeSVG
              value={paymentLink}
              size={150}
              level="M"
              includeMargin={false}
            />
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
