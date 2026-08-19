import { RpcProvider } from 'starknet';

const RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia';

async function scan() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const blockNumber = await provider.getBlockNumber();
  console.log(`Current block: ${blockNumber}`);

  // Let's inspect recent blocks for deployed accounts and declared classes
  for (let i = 0; i < 20; i++) {
    const block = await provider.getBlockWithTxs(blockNumber - i);
    for (const tx of block.transactions) {
      if (tx.type === 'DEPLOY_ACCOUNT') {
        console.log(`Found DEPLOY_ACCOUNT tx in block ${blockNumber - i}:`);
        console.log(`  Class Hash : ${tx.class_hash}`);
        console.log(`  Calldata   : ${JSON.stringify(tx.constructor_calldata)}`);
        return tx.class_hash;
      }
    }
  }
}

scan();
