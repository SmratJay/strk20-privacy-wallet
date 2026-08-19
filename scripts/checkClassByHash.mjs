import { RpcProvider } from 'starknet';

const RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia';

async function check() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  try {
    const res = await provider.getClassByHash('0x061dac032f22811551ccdef710877b173b4664514d3021483d1ba42013c2e577');
    console.log('Found with getClassByHash:', !!res);
  } catch (e) {
    console.log('getClassByHash error:', e.message);
  }
}

check();
