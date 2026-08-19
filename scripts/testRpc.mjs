import { RpcProvider } from 'starknet';

const RPCS = [
  'https://api.cartridge.gg/x/starknet/sepolia',
  'https://starknet-sepolia.public.lava.build',
  'https://free-rpc.nethermind.io/sepolia-juno',
  'https://sepolia.starknet.io',
];

async function testRpc() {
  for (const url of RPCS) {
    try {
      console.log(`Testing ${url}...`);
      const provider = new RpcProvider({ nodeUrl: url });
      const block = await provider.getBlockNumber();
      console.log(`✓ SUCCESS: ${url} (Block: ${block})`);
      return url;
    } catch (err) {
      console.log(`✗ FAILED: ${url} (${err.message})`);
    }
  }
}

testRpc();
