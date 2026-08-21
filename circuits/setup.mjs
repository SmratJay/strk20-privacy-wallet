// PEL circuits — Groth16 trusted setup (dev/test only, not production ceremony).
// Produces zkey + verification key for pel_open and pel_close.
// Usage: node circuits/setup.mjs
import * as snarkjs from 'snarkjs';
import { buildBn128 } from 'ffjavascript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(__dirname, 'build');

const curve = await buildBn128();

const CIRCUITS = [
  { name: 'pel_open', power: 12 },
  { name: 'pel_close', power: 12 },
];

async function setupCircuit(name, power) {
  const r1cs = path.join(build, `${name}.r1cs`);
  const zkey = path.join(build, `${name}.zkey`);
  const vkey = path.join(build, `${name}_verification_key.json`);
  const potDir = path.join(build, 'ptau');

  if (!fs.existsSync(r1cs)) throw new Error(`Missing ${r1cs} — run circom first.`);
  fs.mkdirSync(potDir, { recursive: true });

  const pot0 = path.join(potDir, `pot${power}_0000.ptau`);
  const pot1 = path.join(potDir, `pot${power}_0001.ptau`);
  const pot2 = path.join(potDir, `pot${power}_final.ptau`);

  console.log(`[${name}] 1/4 powers of tau (${power}) ...`);
  if (!fs.existsSync(pot0)) {
    await snarkjs.powersOfTau.newAccumulator(curve, power, pot0);
  }
  await snarkjs.powersOfTau.contribute(pot0, pot1, `${name}-entropy-1`, crypto.randomUUID());
  await snarkjs.powersOfTau.beacon(pot1, pot2, `${name}-beacon`, 10);

  console.log(`[${name}] 2/4 prepare phase2 ...`);
  const pot2ready = path.join(potDir, `pot${power}_final.ptau`);
  await snarkjs.powersOfTau.preparePhase2(pot2, pot2ready);

  console.log(`[${name}] 3/4 groth16 setup ...`);
  await snarkjs.groth16.setup(r1cs, pot2ready, zkey);

  console.log(`[${name}] 4/4 export vkey ...`);
  const vk = await snarkjs.zKey.exportVerificationKey(zkey);
  fs.writeFileSync(vkey, JSON.stringify(vk, null, 2));

  console.log(`[${name}] DONE -> ${zkey}\n`);
}

for (const c of CIRCUITS) {
  await setupCircuit(c.name, c.power);
}
console.log('All circuits set up.');
