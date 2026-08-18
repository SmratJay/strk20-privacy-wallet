'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, ArrowRight, CornerDownLeft, Sparkles, Shield, Zap } from 'lucide-react';
import { PELTabType } from '@/app/page';

interface InteractiveCliBarProps {
  onExecuteCommand: (tab: PELTabType) => void;
}

export const InteractiveCliBar: React.FC<InteractiveCliBarProps> = ({ onExecuteCommand }) => {
  const [inputVal, setInputVal] = useState('');
  const [outputLog, setOutputLog] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCommand = (cmdStr: string) => {
    const clean = cmdStr.trim().toLowerCase();
    if (!clean) return;

    if (clean === '/portfolio' || clean === 'portfolio') {
      setOutputLog('Navigating to Portfolio Surface...');
      onExecuteCommand('PORTFOLIO');
    } else if (clean === '/trade' || clean === '/swap' || clean === 'trade' || clean === 'swap') {
      setOutputLog('Launching Intent Execution Router...');
      onExecuteCommand('SWAP');
    } else if (clean === '/perps' || clean === 'perps') {
      setOutputLog('Opening Privacy-Native Perpetuals Terminal...');
      onExecuteCommand('PERPS');
    } else if (clean === '/earn' || clean === 'earn') {
      setOutputLog('Opening Shielded Lending Vaults...');
      onExecuteCommand('EARN');
    } else if (clean === '/shield' || clean === 'shield') {
      setOutputLog('Launching On-Chain Shielding Bridge...');
      onExecuteCommand('SHIELD');
    } else if (clean === '/invoice' || clean === '/request' || clean === 'invoice') {
      setOutputLog('Opening Stealth Invoice Generator...');
      onExecuteCommand('REQUEST');
    } else if (clean === '/audit' || clean === '/scanner' || clean === 'audit') {
      setOutputLog('Scanning UTXO Notes & Commitments...');
      onExecuteCommand('SCANNER');
    } else if (clean === '/help' || clean === 'help') {
      setOutputLog('Available: /portfolio, /trade, /perps, /earn, /shield, /invoice, /audit, /clear');
    } else if (clean === '/clear' || clean === 'clear') {
      setOutputLog(null);
    } else {
      setOutputLog(`Unknown command "${cmdStr}". Type /help for available commands.`);
    }
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(inputVal);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-zinc-800/90 backdrop-blur-lg px-4 py-2.5 shadow-2xl">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
        {/* CLI Prompt Line */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-orrange-500 font-bold select-none flex items-center gap-1">
            <span>orrange@starknet:~$</span>
          </span>

          <div className="relative flex-1 flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="type /trade, /perps, /shield, /earn, /help..."
              className="w-full bg-transparent text-white font-mono placeholder-zinc-600 outline-none text-xs"
            />
            <span className="w-1.5 h-3.5 bg-orrange-500 animate-blink inline-block shrink-0 ml-1" />
          </div>

          {outputLog && (
            <span className="text-[11px] text-amber-400 bg-zinc-900 px-2 py-0.5 border border-zinc-800 truncate max-w-xs">
              {outputLog}
            </span>
          )}
        </div>

        {/* Quick Clickable Shortcuts */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] text-zinc-500">
          <span className="text-zinc-600 hidden md:inline">SHORTCUTS:</span>
          <button
            onClick={() => handleCommand('/trade')}
            className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-orrange-500 hover:text-orrange-400 text-zinc-300 transition-colors"
          >
            /trade
          </button>
          <button
            onClick={() => handleCommand('/perps')}
            className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-orrange-500 hover:text-orrange-400 text-zinc-300 transition-colors"
          >
            /perps
          </button>
          <button
            onClick={() => handleCommand('/earn')}
            className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-orrange-500 hover:text-orrange-400 text-zinc-300 transition-colors"
          >
            /earn
          </button>
          <button
            onClick={() => handleCommand('/shield')}
            className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-orrange-500 hover:text-orrange-400 text-zinc-300 transition-colors"
          >
            /shield
          </button>
          <button
            onClick={() => handleCommand('/audit')}
            className="px-2 py-0.5 rounded border border-zinc-800 bg-zinc-900 hover:border-orrange-500 hover:text-orrange-400 text-zinc-300 transition-colors"
          >
            /audit
          </button>
        </div>
      </div>
    </div>
  );
};
