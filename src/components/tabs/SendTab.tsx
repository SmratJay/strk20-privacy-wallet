'use client';

import React, { useState, useEffect } from 'react';
import { ArrowUpRight, Lock, UserCheck, AlertCircle, Loader2, Sparkles, Plus, BookOpen, Trash2, Tag } from 'lucide-react';
import { TokenInfo } from '@/config/tokens';
import { ShieldedBalance, privacyService } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount, shortenAddress } from '@/utils/formatters';
import { viewingKeyService, SavedContact } from '@/services/viewingKeyService';
import { useNetwork } from '@/context/NetworkContext';

interface SendTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  initialRecipient?: string;
  initialTokenSymbol?: string;
  initialAmount?: string;
  initialMemo?: string;
  onSuccess: (txHash: string, token: TokenInfo, amount: string, recipient: string) => void;
}

export const SendTab: React.FC<SendTabProps> = ({
  balances,
  wallet,
  initialRecipient = '',
  initialTokenSymbol = '',
  initialAmount = '',
  initialMemo = '',
  onSuccess,
}) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  const [memo, setMemo] = useState(initialMemo);
  const [step, setStep] = useState<'IDLE' | 'PREPARING' | 'PROVING' | 'SUBMITTING'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  // Address book states
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);

  useEffect(() => {
    setContacts(viewingKeyService.getContacts());
  }, []);

  // Update from initial props if passed via deep-link
  useEffect(() => {
    if (initialRecipient) setRecipient(initialRecipient);
    if (initialAmount) setAmount(initialAmount);
    if (initialMemo) setMemo(initialMemo);
    if (initialTokenSymbol) {
      const found = currentNetwork.tokens.find(t => t.symbol.toUpperCase() === initialTokenSymbol.toUpperCase());
      if (found) setSelectedToken(found);
    }
  }, [initialRecipient, initialAmount, initialMemo, initialTokenSymbol, currentNetwork]);

  // Sync token selection when network changes
  useEffect(() => {
    const matching = currentNetwork.tokens.find(t => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;

  const handleMax = () => {
    if (shieldedBal > 0n) {
      setAmount(formatTokenAmount(shieldedBal, selectedToken.decimals, 6));
    }
  };

  const handleSaveCurrentContact = () => {
    if (!newContactName.trim() || !recipient.trim()) return;
    viewingKeyService.saveContact(newContactName, recipient);
    setContacts(viewingKeyService.getContacts());
    setNewContactName('');
    setIsAddingContact(false);
  };

  const handleDeleteContact = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    viewingKeyService.deleteContact(id);
    setContacts(viewingKeyService.getContacts());
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    if (!recipient.trim()) {
      setError('Please enter a recipient privacy address or Starknet address');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid amount');
      return;
    }

    if (amountBigInt > shieldedBal) {
      setError(`Insufficient shielded ${selectedToken.symbol} balance`);
      return;
    }

    setError(null);
    setStep('PREPARING');

    // Clean recipient string (strip strk20: prefix if present)
    const cleanedRecipient = recipient.replace(/^strk20:/i, '').trim();

    try {
      const { txHash } = await privacyService.executePrivateTransfer(
        wallet.walletAccount,
        selectedToken,
        cleanedRecipient,
        amountBigInt,
        (currentStep) => setStep(currentStep),
        currentNetwork.poolAddress,
        currentNetwork.id
      );

      onSuccess(txHash, selectedToken, amount, recipient);
      setAmount('');
      setRecipient('');
      setMemo('');
      setStep('IDLE');
    } catch (err: any) {
      console.error('Private transfer error:', err);
      setError(err.message || 'Private transfer failed');
      setStep('IDLE');
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl">
      {/* Invoice Banner if paying an invoice */}
      {memo && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-emerald-400" />
            <span>
              <strong>Invoice Request:</strong> "{memo}"
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMemo('')}
            className="text-[10px] text-zinc-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-emerald-400" />
            <span>Private Transfer (Encrypted UTXO)</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Transfer shielded funds on {currentNetwork.name} with zero on-chain sender or amount trail
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddressBook(!showAddressBook)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-elevated border border-surface-border hover:border-emerald-500/40 text-zinc-300 text-xs transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
          <span>Address Book ({contacts.length})</span>
        </button>
      </div>

      {/* Address Book Modal / Dropdown */}
      {showAddressBook && (
        <div className="mb-4 p-3.5 rounded-xl bg-surface-elevated border border-emerald-500/30 space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white">Saved Privacy Contacts</span>
            <button
              onClick={() => setIsAddingContact(!isAddingContact)}
              className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <Plus className="w-3 h-3" />
              <span>Add Current</span>
            </button>
          </div>

          {isAddingContact && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                placeholder="Contact Name (e.g. Alice, Treasury)"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className="flex-1 bg-surface border border-surface-border text-white text-xs rounded-lg px-2.5 py-1.5 outline-none"
              />
              <button
                type="button"
                onClick={handleSaveCurrentContact}
                disabled={!newContactName || !recipient}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          )}

          <div className="space-y-1 max-h-36 overflow-y-auto">
            {contacts.length === 0 ? (
              <p className="text-xs text-zinc-500 py-1">No contacts saved yet.</p>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  onClick={() => {
                    setRecipient(c.privacyAddress);
                    setShowAddressBook(false);
                  }}
                  className="flex items-center justify-between p-2 rounded-lg bg-surface hover:bg-zinc-800 cursor-pointer border border-surface-border text-xs text-zinc-200 transition-colors"
                >
                  <div>
                    <span className="font-semibold text-white">{c.name}</span>
                    <span className="font-mono text-zinc-400 text-[10px] ml-2">
                      {shortenAddress(c.privacyAddress, 4)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteContact(c.id, e)}
                    className="p-1 text-zinc-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-4">
        {/* Recipient Privacy Address */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Recipient Address / Viewing Key</span>
            <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <UserCheck className="w-3 h-3" />
              <span>Umbra Stealth Compatible</span>
            </span>
          </div>
          <input
            type="text"
            placeholder="strk20:0x... or 0x..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={step !== 'IDLE'}
            className="w-full bg-surface border border-surface-border text-white text-xs font-mono rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        {/* Asset & Amount */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Asset & Shielded Amount</span>
            <span>
              Shielded Balance:{' '}
              <strong className="text-emerald-400 font-mono">
                {formatTokenAmount(shieldedBal, selectedToken.decimals)} {selectedToken.symbol}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Token Selector */}
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2.5 outline-none focus:border-emerald-500 transition-colors"
            >
              {currentNetwork.tokens.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>

            {/* Amount input */}
            <div className="relative flex-1">
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step !== 'IDLE'}
                className="w-full bg-surface border border-surface-border text-white text-base font-mono rounded-xl px-3 py-2 outline-none focus:border-emerald-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={step !== 'IDLE'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        {/* Relay & Gas Badge */}
        <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-xs text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Paymaster Relayed (No gas link to your address)</span>
          </div>
          <span className="font-mono text-[11px] text-emerald-400">Gas Sponsored</span>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={step !== 'IDLE' || !amount || !recipient}
          className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all"
        >
          {step !== 'IDLE' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {step === 'PREPARING' && 'Deriving ECDH Channel Keys...'}
                {step === 'PROVING' && 'Generating Stwo Zero-Knowledge Proof (~25-30s)...'}
                {step === 'SUBMITTING' && 'Relaying Private Transfer...'}
              </span>
            </>
          ) : (
            <>
              <ArrowUpRight className="w-4 h-4" />
              <span>Send Privately</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
