import { describe, expect, it, vi } from 'vitest';
import { WalletRuntime } from '../wallet/runtime';
import { createMemoryStorage } from '../wallet/storage';
import { READY_V0_4_0_CLASS_HASH } from '../wallet/account';

const call = { contractAddress: '0x1', entrypoint: 'transfer', calldata: ['0x2', '1', '0'] };
function fixture(receipt: () => Promise<object>) {
  const provider = {
    getClassHashAt: vi.fn(async () => READY_V0_4_0_CLASS_HASH),
    callContract: vi.fn(async () => ['0x56614c4944']),
    getBlockNumber: vi.fn(async () => 1000),
    waitForTransaction: vi.fn(receipt),
  };
  const runtime = new WalletRuntime({ storage: createMemoryStorage(), network: 'sepolia', providerFactory: () => provider as never });
  vi.spyOn(runtime, 'refreshPublicBalances').mockResolvedValue([]);
  vi.spyOn(runtime, 'refreshPrivateBalances').mockResolvedValue([]);
  return { runtime, provider };
}

describe('submitted activity and fee review', () => {
  it.each([
    [{ execution_status: 'SUCCEEDED' }, 'success'],
    [{ execution_status: 'REVERTED' }, 'reverted'],
    [{ status: 'REJECTED' }, 'rejected'],
    [{ status: 'ACCEPTED_ON_L2' }, 'pending'],
    [{}, 'pending'],
  ])('uses receipt %j without inventing success', async (receipt, expected) => {
    let resolve!: (value: object) => void;
    const { runtime } = fixture(() => new Promise(r => { resolve = r; }));
    const wallet = await runtime.create('test-only-long-password');
    vi.spyOn(wallet.account, 'execute').mockResolvedValue({ transaction_hash: '0xabc' } as never);
    await runtime.send(call, { kind: 'swap', amount: '123', symbol: 'STRK' });
    expect(runtime.getState().recentTransactions[0]).toMatchObject({ hash: '0xabc', status: 'pending', kind: 'swap', amount: '123', network: 'sepolia' });
    resolve(receipt);
    await vi.waitFor(() => expect(runtime.getState().recentTransactions[0].status).toBe(expected));
    runtime.lock();
  });

  it('drops a late confirmation after network change', async () => {
    let resolve!: (value: object) => void;
    const { runtime } = fixture(() => new Promise(r => { resolve = r; }));
    const wallet = await runtime.create('test-only-long-password');
    vi.spyOn(wallet.account, 'execute').mockResolvedValue({ transaction_hash: '0xabc' } as never);
    await runtime.send(call);
    runtime.setNetwork('mainnet');
    resolve({ execution_status: 'SUCCEEDED' });
    await Promise.resolve(); await Promise.resolve();
    expect(runtime.getState().recentTransactions).toEqual([]);
    expect(runtime.getState().account).toBeNull();
  });

  it('estimates through the local account and rejects non-STRK fee units', async () => {
    const { runtime } = fixture(async () => ({}));
    const wallet = await runtime.create('test-only-long-password');
    const estimate = vi.spyOn(wallet.account, 'estimateInvokeFee').mockResolvedValue({ unit: 'FRI', overall_fee: 123n } as never);
    expect(await runtime.estimateFee(call)).toBe(123n);
    expect(estimate).toHaveBeenCalledWith(call);
    estimate.mockResolvedValue({ unit: 'WEI', overall_fee: 123n } as never);
    await expect(runtime.estimateFee(call)).rejects.toThrow('unavailable in STRK');
    runtime.lock();
  });
});
