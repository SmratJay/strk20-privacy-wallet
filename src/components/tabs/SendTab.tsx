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
      setError('Enter a valid send amount');
      return;
    }

    if (amountBigInt > shieldedBal) {
      setError(`Insufficient shielded ${selectedToken.symbol} balance. Shield tokens first.`);
      return;
    }

    setError(null);
    setStep('PREPARING');

    try {
      const { txHash } = await privacyService.executePrivateTransfer(
        wallet.walletAccount,
        selectedToken,
        amountBigInt,
        recipient.trim(),
        memo.trim() || undefined,
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
      console.error('Send error:', err);
      setError(err.message || 'Failed to send private transaction');
      setStep('IDLE');
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Lock className="w-4 h-4 text-orrange-400" />
            <span>Send Privately (Note → Note)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            100% on-chain privacy • UTXO Note Re-encryption via {currentNetwork.name}
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ PRIVATE_RELAY ]
        </span>
      </div>

      <form onSubmit={handleSend} className="space-y-4">
        {/* Token & Amount Selection */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>SELECT ASSET & AMOUNT</span>
            <span>
              Shielded Balance:{' '}
              <strong className="text-orrange-400">
                {formatTokenAmount(shieldedBal, selectedToken.decimals)} {selectedToken.symbol}
              </strong>
            </span>
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

            <div className="relative flex-1">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step !== 'IDLE'}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-sm outline-none"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={step !== 'IDLE'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
              >
                [MAX]
              </button>
            </div>
          </div>
        </div>

        {/* Recipient Privacy Address */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>RECIPIENT ADDRESS</span>
            <button
              type="button"
              onClick={() => setShowAddressBook(!showAddressBook)}
              className="flex items-center gap-1 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
            >
              <BookOpen className="w-3 h-3" />
              <span>{showAddressBook ? 'Close Book' : `Address Book (${contacts.length})`}</span>
            </button>
          </div>

          {/* Address Book Modal / Dropdown */}
          {showAddressBook && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 space-y-2 mb-2">
              <div className="text-[10px] font-bold uppercase text-zinc-500 flex justify-between">
                <span>Saved Contacts</span>
                <button
                  type="button"
                  onClick={() => setIsAddingContact(!isAddingContact)}
                  className="text-orrange-400 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  <span>New</span>
                </button>
              </div>

              {isAddingContact && (
                <div className="p-2 bg-zinc-900 border border-zinc-800 space-y-2">
                  <input
                    type="text"
                    placeholder="Contact Name (e.g. Alice)"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 text-xs text-white outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddingContact(false)}
                      className="px-2 py-1 text-[10px] text-zinc-400"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveCurrentContact}
                      className="px-2 py-1 bg-orrange-500 text-black font-bold text-[10px]"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              <div className="max-h-32 overflow-y-auto space-y-1">
                {contacts.length === 0 ? (
                  <p className="text-[10px] text-zinc-600">No saved contacts yet.</p>
                ) : (
                  contacts.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setRecipient(c.address);
                        setShowAddressBook(false);
                      }}
                      className="p-1.5 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <span className="text-xs font-bold text-white">{c.name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono block">
                          {shortenAddress(c.address)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteContact(c.id, e)}
                        className="text-zinc-600 hover:text-rose-400 p-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              placeholder="0x... or privacy public key"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={step !== 'IDLE'}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-mono text-xs outline-none"
            />
          </div>
        </div>

        {/* Private Encrypted Memo */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>ENCRYPTED MEMO (OPTIONAL)</span>
            <span className="text-[10px] text-zinc-500">ECDH Channel Key</span>
          </div>
          <input
            type="text"
            placeholder="e.g. Invoice #4120, Salary, Private P2P"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            disabled={step !== 'IDLE'}
            className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-xs outline-none"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Button with Multi-step Feedback */}
        <button
          type="submit"
          disabled={step !== 'IDLE' || !amount || parseFloat(amount) <= 0 || !recipient}
          className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {step === 'PREPARING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 1/3: Deriving Stealth Channel Key...</span>
            </>
          )}
          {step === 'PROVING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 2/3: Generating Nullifier Proof...</span>
            </>
          )}
          {step === 'SUBMITTING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 3/3: Broadcasting Note Re-encryption...</span>
            </>
          )}
          {step === 'IDLE' && <span>Send Privately</span>}
        </button>
      </form>
    </div>
  );
};
