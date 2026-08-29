/**
 * @file src/services/launchMetadata.ts
 * @description ORRANGE LAUNCH off-chain metadata store.
 *
 * On-chain contracts only carry a tiny felt reference (LAUNCH_METADATA_REF). The full
 * description / image / socials payload lives here, keyed by token contract address, so a
 * token launched through TokenFactory is immediately enrichable by Explore and the token
 * page. Persistence is a plain JSON file on the server (smallest practical approach for the
 * MVP); nothing but the short URI reference is ever stored on-chain.
 *
 * The store functions accept an explicit file path so tests can run against a temp dir.
 */
import fs from 'fs';
import path from 'path';
import { normalizeAddress } from '@/services/launchService';

export interface LaunchSocials {
  x?: string;
  telegram?: string;
  website?: string;
}

export interface LaunchMetadataRecord {
  /** Token contract address (the on-chain key). */
  token: string;
  /** Mirrors the on-chain name/symbol so offline rendering needs no extra RPC call. */
  name: string;
  symbol: string;
  description: string;
  image?: string;
  socials: LaunchSocials;
  createdAt: number;
}

export interface LaunchMetadataInput {
  token: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  socials?: Partial<LaunchSocials>;
}

export function defaultStoreFilePath(): string {
  return path.join(process.cwd(), 'data', 'launch-metadata.json');
}

/** Trim, normalize, and drop empty social fields. Pure — safe to unit test. */
export function sanitizeMetadata(input: LaunchMetadataInput): LaunchMetadataRecord {
  const clean = (v: string | undefined): string => (v ?? '').trim().slice(0, 4000);
  const social = (v: string | undefined): string | undefined => {
    const t = clean(v);
    return t || undefined;
  };
  const token = normalizeAddress(input.token);
  if (!token || token === '0x0') throw new Error('A valid token contract address is required.');
  return {
    token,
    name: clean(input.name) || 'Untitled',
    symbol: clean(input.symbol).toUpperCase() || 'TOKEN',
    description: clean(input.description),
    image: social(input.image),
    socials: {
      x: social(input.socials?.x),
      telegram: social(input.socials?.telegram),
      website: social(input.socials?.website),
    },
    createdAt: Date.now(),
  };
}

/** Read all records from the store file (returns {} when absent). */
export function readAllRecords(filePath = defaultStoreFilePath()): Record<string, LaunchMetadataRecord> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LaunchMetadataRecord>) : {};
  } catch {
    return {};
  }
}

/** Persist one record keyed by its normalized token address. Creates the file + dir. */
export function upsertRecord(record: LaunchMetadataRecord, filePath = defaultStoreFilePath()): LaunchMetadataRecord {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const all = readAllRecords(filePath);
  all[record.token] = record;
  fs.writeFileSync(filePath, JSON.stringify(all, null, 2), 'utf8');
  return record;
}

/** Read one record by token address (normalized). */
export function getRecord(
  token: string,
  filePath = defaultStoreFilePath(),
): LaunchMetadataRecord | null {
  const key = normalizeAddress(token);
  if (!key) return null;
  return readAllRecords(filePath)[key] ?? null;
}

/** Client helper: fetch all records from the API (used by Explore for image enrichment). */
export async function fetchAllMetadata(): Promise<Record<string, LaunchMetadataRecord>> {
  if (typeof window === 'undefined') return {};
  try {
    const res = await fetch('/api/launch/metadata');
    if (!res.ok) return {};
    const json = (await res.json()) as Record<string, LaunchMetadataRecord>;
    return json && typeof json === 'object' ? json : {};
  } catch {
    return {};
  }
}

/** Client helper: fetch one record from the API by token address (best-effort). */
export async function fetchMetadataByToken(
  token: string,
): Promise<LaunchMetadataRecord | null> {
  if (typeof window === 'undefined' || !token) return null;
  try {
    const res = await fetch(`/api/launch/metadata?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as LaunchMetadataRecord;
  } catch {
    return null;
  }
}