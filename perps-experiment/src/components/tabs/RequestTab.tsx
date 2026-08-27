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
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const matching = currentNetwork.tokens.find(t => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const privacyReceiveAddress = wallet.address ? `strk20:${wallet.address}` : '';
  
  const baseUrl = origin || 'https://orrange.xyz';
  const paymentLink = wallet.address 
    ? `${baseUrl}/?tab=SEND&to=${encodeURIComponent(privacyReceiveAddress)}&token=${selectedToken.symbol}&amount=${amount}&network=${currentNetwork.id}&memo=${encodeURIComponent(memo)}`
    : '';

  const handleCopyLink = () => {
    if (!wallet.address) {
      showToast({
        type: 'error',
        title: 'Wallet Not Connected',
        description: 'Please connect your Starknet wallet to generate your personal payment invoice link.',
      });
      return;
    }
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
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-orrange-400" />
            <span>Stealth Payment Invoice (Dynamic QR)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Generate QR invoice on {currentNetwork.name}. Payments deposit into your STRK20 channel.
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ INVOICE_GENERATOR ]
        </span>
      </div>

      <div className="space-y-4">
        {/* Asset & Amount Configuration */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>REQUESTED ASSET & AMOUNT</span>
            {isSepolia && <span className="text-[10px] text-amber-400 font-bold uppercase">[ Sepolia Testnet ]</span>}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 text-white font-bold text-xs outline-none cursor-pointer"
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
              className="flex-1 px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-sm outline-none"
            />
          </div>

          <div className="pt-1">
            <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">
              Payment Memo / Reason (ECDH Encrypted)
            </label>
            <input
              type="text"
              placeholder="e.g. Consulting Invoice #104"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 text-xs text-white outline-none focus:border-orrange-500"
            />
          </div>
        </div>

        {/* Dynamic QR Code View */}
        <div className="p-5 bg-zinc-900/40 border border-zinc-800 flex flex-col items-center justify-center space-y-3">
          <div className="p-3 bg-white border border-zinc-700 shadow-md">
            <QRCodeSVG
              value={paymentLink}
              size={170}
              level="M"
              includeMargin={false}
            />
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs font-bold text-white uppercase">
              Scan to Pay {amount || '0'} {selectedToken.symbol} Privately
            </p>
            <p className="text-[10px] text-zinc-500 font-mono">
              Channel: {privacyReceiveAddress ? shortenAddress(privacyReceiveAddress) : '[ Connect Wallet to Generate Channel ]'}
            </p>
          </div>
        </div>

        {/* Action Button: Copy URL */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Invoice URL Copied!' : 'Copy Payment Link'}</span>
        </button>
      </div>
    </div>
  );
};
