import { hash, ec, num } from 'starknet';

// Exact Domain Separation Tags from STRK20 Protocol Specification
export const NOTE_ID_TAG = '0x4e4f54455f49445f5441473a5631'; // "NOTE_ID_TAG:V1"
export const NULLIFIER_TAG = '0x4e554c4c49464945525f5441473a5631'; // "NULLIFIER_TAG:V1"
export const CHANNEL_KEY_TAG = '0x4348414e4e454c5f4b45595f5441473a5631'; // "CHANNEL_KEY_TAG:V1"
export const ENC_AMOUNT_TAG = '0x454e435f414d4f554e545f5441473a5631'; // "ENC_AMOUNT_TAG:V1"
export const ENC_TOKEN_TAG = '0x454e435f544f4b454e5f5441473a5631'; // "ENC_TOKEN_TAG:V1"
export const AUDITOR_ESCROW_TAG = '0x41554449544f525f455343524f575f5441473a5631'; // "AUDITOR_ESCROW_TAG:V1"

export interface UTXONote {
  noteId: string;
  channelKey: string;
  tokenAddress: string;
  tokenSymbol: string;
  index: number;
  salt: string;
  amount: bigint;
  nullifier: string;
  isSpent: boolean;
  blockNumber: number;
  timestamp: number;
  txHash?: string;
  spentForPositionNullifier?: string;
}

export class Strk20Crypto {
  /**
   * Computes Note ID: poseidon_hash(NOTE_ID_TAG, channel_key, token, index, 0)
   */
  computeNoteId(channelKey: string, tokenAddress: string, index: number): string {
    return hash.computePoseidonHashOnElements([
      NOTE_ID_TAG,
      channelKey,
      tokenAddress,
      num.toHex(index),
      '0x0',
    ]);
  }

  /**
   * Computes Nullifier: poseidon_hash(NULLIFIER_TAG, channel_key, token, index, 0, owner_private_key)
   */
  computeNullifier(
    channelKey: string,
    tokenAddress: string,
    index: number,
    ownerPrivateKey: string
  ): string {
    return hash.computePoseidonHashOnElements([
      NULLIFIER_TAG,
      channelKey,
      tokenAddress,
      num.toHex(index),
      '0x0',
      ownerPrivateKey,
    ]);
  }

  /**
   * Derives directional channel key via STARK curve ECDH shared secret + Poseidon domain separation.
   * sharedSecret = ECDH(sender_privkey, recipient_pubkey)
   * Invariant: Never falls back to public derivations to prevent metadata/key leakage (Whitepaper Section 4).
   */
  deriveChannelKeyECDH(
    senderPrivateKey: string,
    recipientPublicKey: string,
    senderAddr: string,
    recipientAddr: string
  ): string {
    if (!senderPrivateKey || !recipientPublicKey) {
      throw new Error('Sender private key and recipient public key are required for channel key derivation');
    }

    try {
      const CURVE_ORDER = 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
      
      // Clean and normalize private key scalar < CURVE_ORDER
      let privClean = senderPrivateKey.startsWith('0x') ? senderPrivateKey.slice(2) : senderPrivateKey;
      const privBig = BigInt('0x' + privClean);
      const normalizedPrivBig = privBig < CURVE_ORDER ? privBig : (privBig % (CURVE_ORDER - 1n)) + 1n;
      const privHex = normalizedPrivBig.toString(16).padStart(64, '0');

      // Recover valid STARK curve ProjectivePoint from recipientPublicKey
      let pubClean = recipientPublicKey.startsWith('0x') ? recipientPublicKey.slice(2) : recipientPublicKey;
      let pubPointHex: string;

      if (pubClean.length === 66 || pubClean.length === 130) {
        pubPointHex = pubClean;
      } else if (pubClean.length === 65 && (pubClean.startsWith('2') || pubClean.startsWith('3'))) {
        pubPointHex = '0' + pubClean[0] + pubClean.slice(1).padStart(64, '0');
      } else if (pubClean.length % 2 !== 0 && (pubClean.startsWith('02') || pubClean.startsWith('03') || pubClean.startsWith('04'))) {
        pubPointHex = pubClean.slice(0, 2) + pubClean.slice(2).padStart(64, '0');
      } else {
        const padded = pubClean.padStart(64, '0');
        // Try both point parities on STARK curve
        try {
          pubPointHex = ec.starkCurve.ProjectivePoint.fromHex('02' + padded).toHex(true);
        } catch {
          pubPointHex = ec.starkCurve.ProjectivePoint.fromHex('03' + padded).toHex(true);
        }
      }

      // Elliptic Curve Diffie-Hellman on STARK curve
      const sharedSecretPoint = ec.starkCurve.getSharedSecret(privHex, pubPointHex);
      const sharedSecretHex = '0x' + Array.from(sharedSecretPoint).map(b => b.toString(16).padStart(2, '0')).join('');
      const sharedSecretFelt = num.toHex(BigInt(sharedSecretHex) % num.toBigInt('0x800000000000011000000000000000000000000000000000000000000000001'));

      return hash.computePoseidonHashOnElements([
        CHANNEL_KEY_TAG,
        sharedSecretFelt,
        senderAddr,
        recipientAddr,
      ]);
    } catch (err: any) {
      throw new Error(`ECDH key agreement failed: ${err?.message || 'Invalid STARK curve keypair'}`);
    }
  }

  /**
   * Computes selective disclosure escrow commitment for auditor viewing key compliance record
   */
  computeAuditorEscrowCommitment(accountAddress: string, viewingPublicKey: string): string {
    return hash.computePoseidonHashOnElements([
      AUDITOR_ESCROW_TAG,
      accountAddress,
      viewingPublicKey,
      '0x0',
    ]);
  }

  /**
   * Symmetric Masking for Note Amount: (poseidon_hash(...) + amount) mod 2^128
   */
  maskAmount(channelKey: string, tokenAddress: string, index: number, salt: string, amount: bigint): bigint {
    const maskHex = hash.computePoseidonHashOnElements([
      ENC_AMOUNT_TAG,
      channelKey,
      tokenAddress,
      num.toHex(index),
      '0x0',
      salt,
    ]);
    const mask = BigInt(maskHex) % (2n ** 128n);
    return (mask + amount) % (2n ** 128n);
  }

  /**
   * Unmask amount given the channel key, salt, and masked ciphertext amount
   */
  unmaskAmount(channelKey: string, tokenAddress: string, index: number, salt: string, encAmount: bigint): bigint {
    const maskHex = hash.computePoseidonHashOnElements([
      ENC_AMOUNT_TAG,
      channelKey,
      tokenAddress,
      num.toHex(index),
      '0x0',
      salt,
    ]);
    const mask = BigInt(maskHex) % (2n ** 128n);
    const diff = (encAmount - mask) % (2n ** 128n);
    return diff >= 0n ? diff : diff + 2n ** 128n;
  }
}

export const strk20Crypto = new Strk20Crypto();
