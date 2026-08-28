/**
 * @file src/__tests__/extendedWalletStatus.test.ts
 * @description Verifies the Starknet wallet deployment check used before native
 * onboarding. A deployed wallet is required because Extended verifies the account
 * on-chain (is_valid_signature).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkWalletDeployment, getExtendedRpcUrl } from '../extended/walletStatus';

describe('Extended wallet deployment check', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports deployed when the RPC returns a class hash (string result)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xabc' }), { status: 200 }),
    );
    const status = await checkWalletDeployment('0x1234abcd', { rpcUrl: 'https://rpc', fetchFn: fetchMock as unknown as typeof fetch });
    expect(status.deployed).toBe(true);
    expect(status.classHash).toBe('0xabc');
    expect(status.unknown).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('starknet_getClassHashAt');
    expect(String(init.body)).toContain('0x1234abcd');
  });

  it('reports deployed for an object-shaped result (back-compat)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { class_hash: '0xdef' } }), { status: 200 }),
    );
    const status = await checkWalletDeployment('0x1234abcd', { rpcUrl: 'https://rpc', fetchFn: fetchMock as unknown as typeof fetch });
    expect(status.deployed).toBe(true);
    expect(status.classHash).toBe('0xdef');
  });

  it('reports not deployed on ContractNotFound (code 20)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 20, message: 'Contract not found' } }), { status: 200 }),
    );
    const status = await checkWalletDeployment('0x1234', { rpcUrl: 'https://rpc', fetchFn: fetchMock as unknown as typeof fetch });
    expect(status.deployed).toBe(false);
    expect(status.unknown).toBeUndefined();
  });

  it('reports unknown (not "not deployed") on RPC node errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Node down' } }), { status: 200 }),
    );
    const status = await checkWalletDeployment('0x1234', { rpcUrl: 'https://rpc', fetchFn: fetchMock as unknown as typeof fetch });
    expect(status.deployed).toBe(false);
    expect(status.unknown).toBe(true);
    expect(status.rpcError).toBe('Node down');
  });

  it('reports unknown on network failure (never maps a network error to not-deployed)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const status = await checkWalletDeployment('0x1234', { rpcUrl: 'https://rpc', fetchFn: fetchMock as unknown as typeof fetch });
    expect(status.deployed).toBe(false);
    expect(status.unknown).toBe(true);
  });

  it('rejects malformed addresses', async () => {
    const status = await checkWalletDeployment('not-an-address', { rpcUrl: 'https://rpc' });
    expect(status.unknown).toBe(true);
  });

  it('resolves a usable mainnet RPC URL', () => {
    const url = getExtendedRpcUrl();
    expect(url.startsWith('https://')).toBe(true);
  });
});