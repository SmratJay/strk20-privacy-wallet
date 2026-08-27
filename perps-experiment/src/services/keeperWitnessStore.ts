/**
 * @file src/services/keeperWitnessStore.ts
 * @description Server-side, encrypted witness escrow for the autonomous liquidation keeper.
 *
 * WHY THIS EXISTS (Critical Issue #5 — permissionless liquidation):
 *   The PEL LIQUIDATE circuit must prove a position is underwater (equity <= maintenance).
 *   That requires the position's private witness (side, q, e, m, funding, fees, nonce,
 *   ownerSecret). A truly permissionless keeper cannot conjure that witness from public
 *   state alone — the circuit binds the liquidation predicate to the commitment, so the
 *   prover MUST hold the witness.
 *
 *   This store implements the industry-standard "escrowed-witness liquidator" trust model:
 *   when a trader opens a position through PEL, the position witness is escrowed to the
 *   keeper (encrypted at rest under a keeper-controlled key, persisted to disk). The
 *   keeper can then construct liquidation proofs autonomously — WITHOUT the trader's
 *   browser, wallet signature, or being online — because it already holds the escrowed
 *   witness.
 *
 *   TRUST ASSUMPTION (explicit, honest):
 *     The keeper is a SEMI-TRUSTED operator: it can read the escrowed witnesses it holds,
 *     and therefore can learn the (already-committed) position parameters for the
 *     positions it liquidates. It does NOT expose them publicly, and the on-chain state
 *     reveals only the commitment/nullifier (the position remains private on-chain and to
 *     all other parties). This is a documented, intentional trade-off vs a fully
 *     trustless keeper, and is the minimal trust required by a witness-bound LIQUIDATE
 *     circuit.
 *
 *   The alternative (a fully trustless keeper) is impossible with the current circuit
 *   because the liquidation predicate is proven over private inputs. See README
 *   "Liquidation / Keeper Architecture" for the options and the recommended circuit
 *   redesign (e.g. an encrypted-liquidity or a dealer/insurance-mediated liquidation)
 *   to reach full trustlessness.
 *
 * STORAGE: JSON file keyed per network at <root>/keeper/escrow/<network>.json. All
 * witness fields are stored AES-256-GCM encrypted under a key derived from
 * KEEPER_WITNESS_KEY (32-byte hex). Fails closed: no plaintext witness is ever written.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrivatePositionState } from '../protocol/types';

const ESCROW_DIR = path.join(process.cwd(), 'keeper', 'escrow');

export interface EscrowedWitness {
  commitment: string;
  marketId: string;
  witness: PrivatePositionState;
  escrowedAtMs: number;
}

function ensureDir(): void {
  if (!fs.existsSync(ESCROW_DIR)) fs.mkdirSync(ESCROW_DIR, { recursive: true });
}

function keyBytes(): Buffer {
  const hex = process.env.KEEPER_WITNESS_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('KEEPER_WITNESS_KEY must be a 32-byte (64-hex) secret to encrypt escrowed witnesses');
  }
  return Buffer.from(hex, 'hex');
}

function fileFor(networkId: string): string {
  ensureDir();
  const safe = networkId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ESCROW_DIR, `${safe}.json`);
}

interface EncryptedFile {
  iv: string;
  tag: string;
  data: string;
}

function encryptPayload(payload: Buffer): EncryptedFile {
  const key = keyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: enc.toString('hex') };
}

function decryptPayload(enc: EncryptedFile): Buffer {
  const key = keyBytes();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(enc.data, 'hex')), decipher.final()]);
}

export class KeeperWitnessStore {
  private cache = new Map<string, EscrowedWitness[]>();

  private load(networkId: string): EscrowedWitness[] {
    const hit = this.cache.get(networkId);
    if (hit) return hit;
    const f = fileFor(networkId);
    if (!fs.existsSync(f)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as EncryptedFile;
      const arr = JSON.parse(decryptPayload(parsed).toString('utf8')) as EscrowedWitness[];
      this.cache.set(networkId, arr);
      return arr;
    } catch (err: any) {
      throw new Error(`KEEPER_WITNESS_STORE: failed to decrypt escrow for ${networkId}: ${err?.message}`);
    }
  }

  private persist(networkId: string, arr: EscrowedWitness[]): void {
    const f = fileFor(networkId);
    const enc = encryptPayload(Buffer.from(JSON.stringify(arr), 'utf8'));
    fs.writeFileSync(f, JSON.stringify(enc), { mode: 0o600 });
    this.cache.set(networkId, arr);
  }

  /** Escrow a position witness so the keeper can liquidate it later. Idempotent per commitment. */
  escrow(networkId: string, entry: EscrowedWitness): void {
    const arr = this.load(networkId).filter((e) => e.commitment.toLowerCase() !== entry.commitment.toLowerCase());
    arr.push(entry);
    this.persist(networkId, arr);
  }

  /** Remove a witness once the position is closed/liquidated. */
  release(networkId: string, commitment: string): boolean {
    const arr = this.load(networkId).filter((e) => e.commitment.toLowerCase() !== commitment.toLowerCase());
    if (arr.length === this.load(networkId).length) return false;
    this.persist(networkId, arr);
    return true;
  }

  /** List all escrowed witnesses for a network (decrypted in memory only). */
  list(networkId: string): EscrowedWitness[] {
    return this.load(networkId);
  }

  /** Find a single escrowed witness by commitment. */
  find(networkId: string, commitment: string): EscrowedWitness | undefined {
    const c = commitment.toLowerCase();
    return this.load(networkId).find((e) => e.commitment.toLowerCase() === c);
  }

  count(networkId: string): number {
    return this.load(networkId).length;
  }
}

export const keeperWitnessStore = new KeeperWitnessStore();
