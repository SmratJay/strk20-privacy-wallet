import { describe, it, expect, vi } from 'vitest';
import { PublicCrossChainService } from '@/features/public-cross-chain/service';
import { NearIntentClient } from '@/features/near-intents/client';
import { NEAR_INTENT_ROUTES } from '@/features/near-intents/routes';
import { createMemoryStorage } from '@/wallet/storage';

function fixture(network = 'mainnet') {
  const storage = createMemoryStorage();
  const client = new NearIntentClient();
  const send = vi.fn().mockResolvedValue({ transactionHash: '0x123' });
  const assertActive = vi.fn();
  vi.spyOn(client, 'requestQuote').mockImplementation(async request => ({
    quoteRequest: request,
    quote: { amountIn: request.amount, amountOut: '1000000', minAmountOut: '990000', ...(request.dry ? {} : { depositAddress: '0x456' }) },
  }));
  vi.spyOn(client, 'submitDepositTx').mockResolvedValue(undefined);
  vi.spyOn(client, 'getStatus').mockResolvedValue({ status: 'PROCESSING' });
  const deps = { walletId: 'test', address: '0x789', network, storage, assertActive,
    send, estimate: vi.fn().mockResolvedValue(100n), balance: vi.fn().mockResolvedValue(100000000000000000000n),
    client, routes: async () => [...NEAR_INTENT_ROUTES] };
  const service = new PublicCrossChainService(deps);
  const input = { routeId: NEAR_INTENT_ROUTES[0].id, amount: 2000000000000000000n,
    recipient: '0x742d35cc6634c0532925a3b8d84b2021f90a51a3', slippageBps: 100 };
  const prepare = async () => service.prepare((await service.quote(input)).id);
  return { service, deps, input, prepare, client, send, storage };
}
describe('explicit public cross-chain funding', () => {
  it('blocks Sepolia before contacting the provider', async () => {
    const f = fixture('sepolia');
    await expect(f.service.quote(f.input)).rejects.toThrow('Mainnet');
    expect(f.client.requestQuote).not.toHaveBeenCalled();
  });
  it('requires final preparation and keeps caller mutations away from transfer', async () => {
    const f = fixture(); const dry = await f.service.quote(f.input);
    await expect(f.service.execute(dry.id)).rejects.toThrow('Quote');
    const q = await f.service.prepare(dry.id);
    q.amount = '999'; q.recipient = 'changed';
    const result = await f.service.execute(q.id);
    expect(result.quote.amount).toBe(f.input.amount.toString());
    expect(result.quote.recipient).toBe(f.input.recipient);
    expect(f.send).toHaveBeenCalledTimes(1);
    await expect(f.service.execute(q.id)).rejects.toThrow('reconciliation');
  });
  it('rejects a substituted provider recipient', async () => {
    const f = fixture();
    vi.mocked(f.client.requestQuote).mockImplementation(async request => ({
      quoteRequest: { ...request, recipient: 'attacker' }, quote: { amountIn: request.amount, amountOut: '100', minAmountOut: '99' },
    }));
    await expect(f.service.quote(f.input)).rejects.toThrow('different swap');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('retains an uncertain submission across service recreation without retry', async () => {
    const f = fixture(); const q = await f.prepare();
    f.send.mockRejectedValue(new Error('timeout'));
    await expect(f.service.execute(q.id)).rejects.toThrow('timeout');
    expect(f.service.readReceipt()?.phase).toBe('unknown');
    const restarted = new PublicCrossChainService(f.deps);
    await expect(restarted.quote(f.input)).rejects.toThrow('reconciliation');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('does not mark success without destination evidence', async () => {
    const f = fixture(); await f.service.execute((await f.prepare()).id);
    vi.mocked(f.client.getStatus).mockResolvedValue({ status: 'SUCCESS' });
    expect((await f.service.refresh())?.phase).toBe('unknown');
    vi.mocked(f.client.getStatus).mockResolvedValue({ status: 'SUCCESS', swapDetails: { amountOut: '1000000', destinationChainTxHashes: ['destination-hash'] } });
    expect((await f.service.refresh())?.phase).toBe('success');
    vi.mocked(f.client.getStatus).mockResolvedValue({ status: 'PROCESSING' });
    expect((await f.service.refresh())?.phase).toBe('success');
  });
  it('never funds if journal persistence fails', async () => {
    const f = fixture(); const q = await f.prepare();
    vi.spyOn(f.storage, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    await expect(f.service.execute(q.id)).rejects.toThrow('disk full');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('invalidates a prepared quote on wallet change', async () => {
    const f = fixture(); const q = await f.prepare();
    f.deps.assertActive.mockImplementation(() => { throw new Error('Wallet changed'); });
    await expect(f.service.execute(q.id)).rejects.toThrow('Wallet changed');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects fee increases and insufficient balances before signing', async () => {
    const f = fixture(); const q = await f.prepare();
    f.deps.estimate.mockResolvedValue(200n);
    await expect(f.service.execute(q.id)).rejects.toThrow('fee increased');
    f.deps.estimate.mockResolvedValue(100n); f.deps.balance.mockResolvedValue(0n);
    await expect(f.service.execute(q.id)).rejects.toThrow('Insufficient');
    expect(f.send).not.toHaveBeenCalled();
  });
});
