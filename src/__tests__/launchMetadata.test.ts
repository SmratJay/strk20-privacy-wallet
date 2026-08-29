import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  sanitizeMetadata,
  upsertRecord,
  getRecord,
  readAllRecords,
  LaunchMetadataInput,
} from '@/services/launchMetadata';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-metadata-test-'));
const storeFile = path.join(tmpDir, 'launch-metadata.json');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const input: LaunchMetadataInput = {
  token: '0x1234ABCDEF',
  name: '  Hampton the Hamster  ',
  symbol: '  hamstr  ',
  description: 'A very good boy.',
  image: 'https://example.com/hamster.png',
  socials: { x: ' @hamstr ', telegram: '', website: 'https://hamstr.example' },
};

describe('launchMetadata store', () => {
  it('sanitizes and normalizes a record (keyed by normalized token address)', () => {
    const r = sanitizeMetadata(input);
    expect(r.token).toBe('0x1234abcdef');
    expect(r.name).toBe('Hampton the Hamster');
    expect(r.symbol).toBe('HAMSTR');
    expect(r.socials.x).toBe('@hamstr');
    expect(r.socials.telegram).toBeUndefined(); // empty dropped
    expect(r.socials.website).toBe('https://hamstr.example');
  });

  it('rejects records without a valid token address', () => {
    expect(() => sanitizeMetadata({ token: '', name: 'x', symbol: 'x' })).toThrow();
    expect(() => sanitizeMetadata({ token: '0x0', name: 'x', symbol: 'x' })).toThrow();
  });

  it('round-trips through the file-backed store, resolving by token address', () => {
    const r = sanitizeMetadata(input);
    upsertRecord(r, storeFile);
    const byAddr = getRecord('0x1234ABCDEF', storeFile);
    expect(byAddr).not.toBeNull();
    expect(byAddr?.description).toBe('A very good boy.');
    expect(byAddr?.symbol).toBe('HAMSTR');
    expect(readAllRecords(storeFile)['0x1234abcdef']).toBeDefined();
  });

  it('upsert overwrites the same token and keeps unrelated records', () => {
    upsertRecord(sanitizeMetadata(input), storeFile);
    const updated = sanitizeMetadata({ ...input, description: 'Updated description' });
    upsertRecord(updated, storeFile);
    const all = readAllRecords(storeFile);
    expect(Object.keys(all)).toHaveLength(1);
    expect(getRecord(input.token, storeFile)?.description).toBe('Updated description');
  });

  it('returns null/empty for missing data', () => {
    expect(getRecord('0x0000000000000000000000000000000000000000000000000000000000000000', storeFile)).toBeNull();
    expect(readAllRecords(path.join(tmpDir, 'missing.json'))).toEqual({});
  });
});