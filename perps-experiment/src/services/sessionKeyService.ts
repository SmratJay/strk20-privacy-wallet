/**
 * @file sessionKeyService.ts
 * @description PEL Scoped Session Key & Paymaster Abstraction (Section 9)
 * Formula: SK = (pk, exp, contracts, selectors, limits)
 * Enables seamless 1-click execution without repetitive wallet signature popups.
 */

import { ec } from 'starknet';

export interface ScopedSessionKey {
  publicKey: string;
  expiresAt: number; // Unix timestamp ms
  allowedContracts: string[];
  allowedSelectors: string[];
  dailySpendLimitUsd: number;
  spentTodayUsd: number;
  isActive: boolean;
  authorizedBy: string;
}

class SessionKeyService {
  /**
   * Check if an active session key exists for a wallet
   */
  getSession(walletAddress: string): ScopedSessionKey | null {
    if (typeof window === 'undefined') return null;
    try {
      const key = `pel_session_key_${walletAddress.toLowerCase()}`;
      const saved = localStorage.getItem(key);
      if (!saved) return null;
      const session: ScopedSessionKey = JSON.parse(saved);

      // Check expiration
      if (Date.now() > session.expiresAt || !session.isActive) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Create a new scoped session key (valid for 8 hours by default)
   * Formula: SK = (pk, exp, contracts, selectors, limits) — Whitepaper Section 9.1
   */
  createSession(
    walletAddress: string,
    dailyLimitUsd: number = 5000,
    durationHours: number = 8
  ): ScopedSessionKey {
    // Generate cryptographically secure ephemeral Starknet session keypair
    const CURVE_ORDER = 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
    const entropy = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(entropy);
    } else {
      // Node / test environment fallback
      try {
        const nodeCrypto = require('crypto');
        nodeCrypto.randomFillSync(entropy);
      } catch {
        for (let i = 0; i < 32; i++) entropy[i] = Math.floor(Math.random() * 256);
      }
    }

    const rawEntropyBig = BigInt('0x' + Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join(''));
    const ephemeralPrivBig = (rawEntropyBig % (CURVE_ORDER - 1n)) + 1n;
    const ephemeralPrivHex = '0x' + ephemeralPrivBig.toString(16);
    const ephemeralPub = ec.starkCurve.getStarkKey(ephemeralPrivHex);

    const session: ScopedSessionKey = {
      publicKey: ephemeralPub,
      expiresAt: Date.now() + durationHours * 3600 * 1000,
      allowedContracts: [
        '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a', // Mainnet STRK20 Pool
        '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91', // Sepolia STRK20 Pool
        '0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc9e111865116ecd4d6', // AVNU Router
      ],
      allowedSelectors: ['swap', 'openPosition', 'closePosition', 'deposit', 'transfer'],
      dailySpendLimitUsd: dailyLimitUsd,
      spentTodayUsd: 0,
      isActive: true,
      authorizedBy: walletAddress,
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(`pel_session_key_${walletAddress.toLowerCase()}`, JSON.stringify(session));
    }

    return session;
  }

  /**
   * Record spend under session limit
   */
  recordSpend(walletAddress: string, amountUsd: number): boolean {
    const session = this.getSession(walletAddress);
    if (!session) return false;

    if (session.spentTodayUsd + amountUsd > session.dailySpendLimitUsd) {
      return false; // Exceeds limit
    }

    session.spentTodayUsd += amountUsd;
    if (typeof window !== 'undefined') {
      localStorage.setItem(`pel_session_key_${walletAddress.toLowerCase()}`, JSON.stringify(session));
    }
    return true;
  }

  /**
   * Instantly revoke the session
   */
  revokeSession(walletAddress: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`pel_session_key_${walletAddress.toLowerCase()}`);
  }
}

export const sessionKeyService = new SessionKeyService();
