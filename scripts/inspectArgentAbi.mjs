import { RpcProvider } from 'starknet';

const RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia';
const ARGENT_CLASS_HASH = '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f';

async function check() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const contractClass = await provider.getClassByHash(ARGENT_CLASS_HASH);
  console.log('Argent ABI items:');
  for (const item of contractClass.abi) {
    if (item.type === 'constructor' || item.name === 'constructor') {
      console.log('Constructor ABI:', JSON.stringify(item, null, 2));
    }
  }
}

check();
