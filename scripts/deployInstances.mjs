import { Account, RpcProvider, CallData } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const PRAGMA_ORACLE_SEPOLIA = '0x036031dbdd236a73f004d3161b476ac89aaab2794be0d0417ee250ef4ed93a21';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'sepolia_contracts.json');
const ENV_LOCAL_FILE = path.join(process.cwd(), '.env.local');

const CLASS_HASHES = {
  StwoVerifier: '0x26e286a86abeef1503ba0d7e48c356bdf22d74899d92ed2b6962b7f47c4038b',
  OracleAdapter: '0x501a921124d4b0bb788bc18cb5829db0925c11791c5694829bc88abc25add7',
  STRK20Adapter: '0x7389c772ec14e3710a259040a8423c27fc05702bccf68c7be5bd2dcea82d087',
  PELPerpsCore: '0xbca5229077e28214844fd6aa52624070e47327d0406789b9c2e5079bac6bfd',
};

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  console.log('=============================================================');
  console.log('  DEPLOYING & WIRING 4 UPGRADED CONTRACTS ON SEPOLIA');
  console.log('  Deployer Address: ' + deployerData.accountAddress);
  console.log('=============================================================');

  const deployBounds = {
    l2_gas: { max_amount: 80000000n, max_price_per_unit: 100000000000n },
    l1_gas: { max_amount: 10000n, max_price_per_unit: 300000000000000n },
    l1_data_gas: { max_amount: 5000n, max_price_per_unit: 15000000000000n },
  };

  const deploy = async (name, classHash, constructorCalldata) => {
    console.log(`\nDeploying ${name}...`);
    const res = await account.deployContract(
      { classHash, constructorCalldata },
      { resourceBounds: deployBounds }
    );
    console.log(`Deploy Tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    const contractAddress = Array.isArray(res.contract_address) ? res.contract_address[0] : res.contract_address;
    console.log(`✓ ${name} Deployed at: \x1b[32m${contractAddress}\x1b[0m`);
    return contractAddress;
  };

  // 1. Deploy StwoVerifier
  const stwoAddress = await deploy(
    'StwoVerifier',
    CLASS_HASHES.StwoVerifier,
    CallData.compile({ admin: deployerData.accountAddress })
  );

  // 2. Deploy OracleAdapter
  const oracleAddress = await deploy(
    'OracleAdapter',
    CLASS_HASHES.OracleAdapter,
    CallData.compile({ admin: deployerData.accountAddress, pragma_oracle: PRAGMA_ORACLE_SEPOLIA })
  );

  // 3. Deploy PELPerpsCore (initially passing deployer as strk20 placeholder)
  const pelCoreAddress = await deploy(
    'PELPerpsCore',
    CLASS_HASHES.PELPerpsCore,
    CallData.compile({
      admin: deployerData.accountAddress,
      oracle_adapter: oracleAddress,
      strk20_adapter: deployerData.accountAddress,
      stwo_verifier: stwoAddress,
    })
  );

  // 4. Deploy STRK20Adapter (with pel_core set to pelCoreAddress)
  const strk20Address = await deploy(
    'STRK20Adapter',
    CLASS_HASHES.STRK20Adapter,
    CallData.compile({
      admin: deployerData.accountAddress,
      pel_core: pelCoreAddress,
    })
  );

  // 5. Wire STRK20Adapter address into PELPerpsCore on-chain
  console.log('\nWiring STRK20Adapter into PELPerpsCore on-chain...');
  const wireRes = await account.execute(
    [
      {
        contractAddress: pelCoreAddress,
        entrypoint: 'set_strk20_adapter',
        calldata: [strk20Address],
      },
    ],
    { resourceBounds: deployBounds }
  );
  console.log(`Wire Tx: ${wireRes.transaction_hash}`);
  await provider.waitForTransaction(wireRes.transaction_hash);
  console.log('✓ PELPerpsCore linked with STRK20Adapter on-chain!');

  // Save Deployed Addresses
  const deployedSummary = {
    network: 'sepolia',
    rpcUrl: SEPOLIA_RPC,
    deployedAt: new Date().toISOString(),
    contracts: {
      PELPerpsCore: pelCoreAddress,
      STRK20Adapter: strk20Address,
      OracleAdapter: oracleAddress,
      StwoVerifier: stwoAddress,
    },
    explorer: {
      PELPerpsCore: `https://sepolia.voyager.online/contract/${pelCoreAddress}`,
      STRK20Adapter: `https://sepolia.voyager.online/contract/${strk20Address}`,
      OracleAdapter: `https://sepolia.voyager.online/contract/${oracleAddress}`,
      StwoVerifier: `https://sepolia.voyager.online/contract/${stwoAddress}`,
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(deployedSummary, null, 2));

  // Update .env.local
  let envContent = '';
  if (fs.existsSync(ENV_LOCAL_FILE)) {
    envContent = fs.readFileSync(ENV_LOCAL_FILE, 'utf8');
  }

  const envLines = [
    `NEXT_PUBLIC_PEL_CORE_SEPOLIA=${pelCoreAddress}`,
    `NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA=${strk20Address}`,
    `NEXT_PUBLIC_ORACLE_ADAPTER_SEPOLIA=${oracleAddress}`,
    `NEXT_PUBLIC_STWO_VERIFIER_SEPOLIA=${stwoAddress}`,
  ];

  for (const line of envLines) {
    const key = line.split('=')[0];
    if (envContent.includes(key)) {
      envContent = envContent.replace(new RegExp(`${key}=.*`), line);
    } else {
      envContent += `\n${line}`;
    }
  }

  fs.writeFileSync(ENV_LOCAL_FILE, envContent.trim() + '\n');

  console.log('\n=============================================================');
  console.log('  ALL 4 CAIRO CONTRACTS DEPLOYED & WIRED ON SEPOLIA!');
  console.log('=============================================================');
  console.log(`  PELPerpsCore  : ${pelCoreAddress}`);
  console.log(`  STRK20Adapter : ${strk20Address}`);
  console.log(`  OracleAdapter : ${oracleAddress}`);
  console.log(`  StwoVerifier  : ${stwoAddress}`);
  console.log('  Saved to      : deployments/sepolia_contracts.json');
  console.log('  Updated       : .env.local');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('Deployment error:', err.message || err);
  process.exit(1);
});
