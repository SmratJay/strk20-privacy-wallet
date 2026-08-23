'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUpRight, Lock, BookOpen, AlertCircle, Loader2, Plus, Trash2, Wallet } from 'lucide-react';
import { TokenInfo } from '@/config/tokens';
import { ShieldedBalance } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount, shortenAddress } from '@/utils/formatters';
import { viewingKeyService, SavedContact } from '@/services/viewingKeyService';
import { useNetwork } from '@/context/NetworkContext';
import {
  strk20WalletApiService,
  WalletApiStatus,
  WalletBalancePermission,
  translateWalletError,
} from '@/services/strk20WalletApiService';
import {
  Strk20WalletLaneGate,
  isWalletLaneReady,
  PrivateBalanceAccessNote,
} from '@/components/terminal/Strk20WalletLaneGate';

interface SendTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  initialRecipient?: string;
  initialTokenSymbol?: string;
  initialAmount?: string;
  privateBalancePermission?: WalletBalancePermission;
  onRequestPrivateBalanceAccess?: () => void;
  onSuccess: (txHash: string, token: TokenInfo, amount: string, recipient: string) => void;
}

type TxPhase =
  | 'IDLE'
  | 'PREPARING'
  | 'WALLET_APPROVAL'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'COMPLETE'
  | 'FAILED';

export const SendTab: React.FC<SendTabProps> = ({
  balances,
  wallet,
  initialRecipient = '',
  initialTokenSymbol = '',
  initialAmount = '',
  privateBalancePermission = 'UNKNOWN',
  onRequestPrivateBalanceAccess,
  onSuccess,
}) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  const [phase, setPhase] = useState<TxPhase>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletApiStatus | null>(null);
  const [checking, setChecking] = useState(true);

  // Address book states
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await strk20WalletApiService.getWalletApiStatus(wallet));
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, [wallet]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    setContacts(viewingKeyService.getContacts());
  }, []);

  // Update from initial props if passed via deep-link
  useEffect(() => {
    if (initialRecipient) setRecipient(initialRecipient);
    if (initialAmount) setAmount(initialAmount);
    if (initialTokenSymbol) {
      const found = currentNetwork.tokens.find((t) => t.symbol.toUpperCase() === initialTokenSymbol.toUpperCase());
      if (found) setSelectedToken(found);
    }
  }, [initialRecipient, initialAmount, initialTokenSymbol, currentNetwork]);

  // Sync token selection when network changes
  useEffect(() => {
    const matching = currentNetwork.tokens.find((t) => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;
  const shieldedBalAvailable = currentBalance?.shieldedBalanceAvailable === true;
  const ready = isWalletLaneReady(status);

  const handleMax = () => {
    if (shieldedBalAvailable && shieldedBal > 0n) {
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
    if (!ready) return;

    if (!recipient.trim()) {
      setError('Please enter the recipient Starknet address.');
      return;
    }
    try {
      BigInt(recipient);
    } catch {
      setError('Please enter a valid recipient Starknet address.');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid send amount');
      return;
    }

    if (shieldedBalAvailable && amountBigInt > shieldedBal) {
      setError(`Insufficient private ${selectedToken.symbol} balance. Shield funds first.`);
      return;
    }

    setError(null);
    setPhase('PREPARING');

    try {
      // The privacy wallet performs the private note transfer + proof.
      setPhase('WALLET_APPROVAL');
      const receipt = await strk20WalletApiService.privateTransfer(
        wallet,
        selectedToken.address,
        amountBigInt,
        recipient.trim(),
      );
      setTxHash(receipt.transactionHash);
      setPhase('SUBMITTED');

      const reconcile = await strk20WalletApiService.waitForStrk20Confirmation(
        receipt.transactionHash,
      );
      if (reconcile === 'CONFIRMED') {
        setPhase('COMPLETE');
        onSuccess(receipt.transactionHash, selectedToken, amount, recipient);
        setAmount('');
        setRecipient('');
      } else if (reconcile === 'REVERTED') {
        setPhase('FAILED');
        setError('The private transfer transaction reverted on-chain.');
      } else {
        setPhase('SUBMITTED');
      }
    } catch (err: any) {
      const t = translateWalletError(err, { asset: selectedToken.symbol });
      setError(t.userMessage);
      setPhase('FAILED');
    }
  };

  const busy = phase !== 'IDLE' && phase !== 'FAILED' && phase !== 'COMPLETE';

  return (
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Lock className="w-4 h-4 text-orrange-400" />
            <span>Send Privately (Note → Note)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Privacy wallet · Wallet API · STRK20 private transfer
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ WALLET_LANE ]
        </span>
      </div>

      <Strk20WalletLaneGate
        status={status}
        checking={checking}
        onConnect={() => (wallet.openConnectModal ? wallet.openConnectModal() : wallet.connectWallet())}
      />

      {ready && (
        <form onSubmit={handleSend} className="space-y-4">
          <PrivateBalanceAccessNote
            permission={privateBalancePermission}
            onRequest={onRequestPrivateBalanceAccess ?? (() => {})}
          />
          <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>SELECT ASSET & AMOUNT</span>
              <span>
                Private Balance:{' '}
                <strong className="text-orrange-400">
                  {shieldedBalAvailable
                    ? `${formatTokenAmount(shieldedBal, selectedToken.decimals)} ${selectedToken.symbol}`
                    : '—'}
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
                  disabled={busy}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={busy}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
                >
                  [MAX]
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>RECIPIENT STARKNET ADDRESS</span>
              <button
                type="button"
                onClick={() => setShowAddressBook(!showAddressBook)}
                className="flex items-center gap-1 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
              >
                <BookOpen className="w-3 h-3" />
                <span>{showAddressBook ? 'Close Book' : `Address Book (${contacts.length})`}</span>
              </button>
            </div>

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
                          setRecipient(c.privacyAddress);
                          setShowAddressBook(false);
                        }}
                        className="p-1.5 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800/80 flex items-center justify-between cursor-pointer"
                      >
                        <div>
                          <span className="text-xs font-bold text-white">{c.name}</span>
                          <span className="text-[10px] text-zinc-500 font-mono block">
                            {shortenAddress(c.privacyAddress)}
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

            <input
              type="text"
              placeholder="0x… (recipient Starknet address)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={busy}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-mono text-xs outline-none"
            />
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {txHash && (phase === 'SUBMITTED' || phase === 'CONFIRMING') && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
              Submitted — awaiting on-chain confirmation. Proof generation happens in your
              wallet, so this can take longer than a normal transaction. Explorer:{' '}
              <a
                href={`https://sepolia.voyager.online/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline break-all"
              >
                {txHash.slice(0, 18)}…
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !amount || parseFloat(amount) <= 0 || !recipient}
            className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {phase === 'PREPARING' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Preparing private transfer…</span>
              </>
            )}
            {phase === 'WALLET_APPROVAL' && (
              <>
                <Wallet className="w-4 h-4" />
                <span>Approve in your wallet (proof generation)…</span>
              </>
            )}
            {phase === 'SUBMITTED' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming on-chain…</span>
              </>
            )}
            {phase === 'COMPLETE' && <span>✓ Private transfer submitted</span>}
            {phase === 'FAILED' && <span>Retry Send</span>}
            {phase === 'IDLE' && <span>Send Privately</span>}
          </button>
        </form>
      )}
    </div>
  );
};