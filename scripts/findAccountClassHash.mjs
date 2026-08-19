import { RpcProvider } from 'starknet';

const RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia';

const CANDIDATES = [
  { name: 'OZ Account 1', hash: '0x07b3e05f48f0c69e4a65ce5e076a66271a527afd241ce433f73164ddbeac45fd' },
  { name: 'OZ Account 2', hash: '0x02338634f3f4115a6cda440977e422117503483b728096db0526e7c94fa13325' },
  { name: 'OZ Account 3', hash: '0x05b95574c8567ee753557e0fa80a221f75b8e96bf0ec15f40e0ab5dd33b3b64c' },
  { name: 'OZ Account 4', hash: '0x00e2eb8f5672af4e6a4e8a8f1b449d737e80479bc39f3d3f4da446b25451adba' },
  { name: 'OZ Account 5', hash: '0x06f1ebae31d3f9261a87e596ad28ab599427b0c950d8985eb9c0a6b7d3493c04' },
  { name: 'Argent Account v0.4.0', hash: '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f' },
];

async function check() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  for (const c of CANDIDATES) {
    try {
      await provider.getClassByHash(c.hash);
      console.log(`✓ FOUND VALID: ${c.name} -> \x1b[32m${c.hash}\x1b[0m`);
    } catch (e) {}
  }
}

check();
