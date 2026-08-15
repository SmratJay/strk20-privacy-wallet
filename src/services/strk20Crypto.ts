import { hash, ec, num, constants } from 'starknet';

// Exact Domain Separation Tags from STRK20 Protocol Specification
export const NOTE_ID_TAG = '0x4e4f54455f49445f5441473a5631'; // "NOTE_ID_TAG:V1"
export const NULLIFIER_TAG = '0x4e554c4c49464945525f5441473a5631'; // "NULLIFIER_TAG:V1"
export const CHANNEL_KEY_TAG = '0x4348414e4e454c5f4b45595f5441473a5631'; // "CHANNEL_KEY_TAG:V1"
export const ENC_AMOUNT_TAG = '0x454e435f414d4f554e545f5441473a5631'; // "ENC_AMOUNT_TAG:V1"
export const ENC_TOKEN_TAG = '0x454e435f544f4b454e5f5441473a5631'; // "ENC_TOKEN_TAG:V1"

export interface SimulatedNote {
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
   * Derives directional channel key between sender and recipient
   */
  deriveChannelKey(
    senderAddr: string,
    senderPrivateKey: string,
    recipientAddr: string,
    recipientPublicKey: string
  ): string {
    return hash.computePoseidonHashOnElements([
      CHANNEL_KEY_TAG,
      senderAddr,
      senderPrivateKey,
      recipientAddr,
      recipientPublicKey,
    ]);
  }

  /**
   * Symmetric Masking for Note Amount (poseidon hash + amount mod 2^128)
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
   * Unmask amount given the channel key and salt
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
