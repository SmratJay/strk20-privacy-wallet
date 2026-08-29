'use client';

import React, { useState } from 'react';
import { EyeOff, ChevronDown } from 'lucide-react';

/**
 * "Why is this private?" — communicates STRK20's real privacy properties with plain
 * language first, technical terms tucked into an advanced expandable section. Never
 * overclaims ("100% anonymous" / "untraceable").
 */
export const PrivacyInfo: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const HIDDEN = ['Sender', 'Recipient', 'Amount', 'Token type'];

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="privacy-info-details"
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <EyeOff className="w-4 h-4 text-violet-300" />
          Why is this private?
        </span>
        <ChevronDown
          className={`w-4 h-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id="privacy-info-details" className="px-5 pb-5 space-y-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            Your payments run through the STRK20 privacy pool on Starknet. What you send and
            receive stays private:
          </p>

          <ul className="space-y-2">
            {HIDDEN.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-zinc-200">
                <span className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center text-[10px]">
                  ✓
                </span>
                {item} is hidden
              </li>
            ))}
          </ul>

          <button
            onClick={() => setAdvanced(!advanced)}
            className="text-[12px] text-violet-300 hover:underline"
          >
            {advanced ? 'Hide' : 'Show'} technical details
          </button>

          {advanced && (
            <div className="space-y-2 text-[12px] text-zinc-500 leading-relaxed">
              <p>Under the hood, STRK20 uses:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Encrypted pool notes for private balances</li>
                <li>Viewing-key discovery performed inside your privacy wallet to find payments sent to you</li>
                <li>The STRK20 privacy pool to keep sender, recipient, amount, and token hidden</li>
              </ul>
              <p className="text-zinc-600">
                Private means hidden through the STRK20 privacy pool — it does not hide broader
                network activity such as the timing of your transactions.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
