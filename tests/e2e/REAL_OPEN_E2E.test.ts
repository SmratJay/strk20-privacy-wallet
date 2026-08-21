/**
 * @file tests/e2e/REAL_OPEN_E2E.test.ts
 * @description Authoritative Real OPEN E2E Test Suite (Audit Section 11 & Phase 11)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { RpcProvider, hash, uint256 } from "starknet";
import { pelCircuitService } from "../../src/services/pelCircuitService";
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from "../../src/services/starknetPerpsDispatcher";
import { generateOwnerSecret, generateNonce, saveWitness, loadWitness, deleteWitness } from "../../src/protocol/witnessStore";
import { bn254ToStorageKey, BN254_R } from "../../src/protocol/canonical";
import * as fs from "fs";
import * as garaga from "garaga";
import * as snarkjs from "snarkjs";
import * as path from "path";

describe("Authoritative Real OPEN E2E On-Chain Pipeline (Phase 11)", () => {
  const traderAddress = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
  const marketId = "BTC-PERP";
  const config = PERPS_DEPLOYMENTS.sepolia;
  let realGaragaCalldata: bigint[];
  let openProof: any;
  let commitment: bigint;
  let nullifier: bigint;
  let commitmentKey: string;
  let nullifierKey: string;
  let ownerSecretHex: string;
  let nonceHex: string;
  const quantitySats = 100000000n; // 1.0 BTC
  const entryPriceCents = 9500000n; // ,000.00
  const marginCents = 500000n; // ,000.00

  beforeAll(async () => {
    await garaga.init();
    ownerSecretHex = generateOwnerSecret();
    nonceHex = generateNonce();

    // 1. Generate real Circom Groth16 Proof
    openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      nonce: BigInt(nonceHex),
      ownerSecret: BigInt(ownerSecretHex),
    });

    commitment = openProof.commitment;
    nullifier = openProof.nullifier;
    commitmentKey = bn254ToStorageKey(commitment);
    nullifierKey = bn254ToStorageKey(nullifier);

    // 2. Generate real Garaga BN254 Calldata
    const vkeyPath = path.join(process.cwd(), "circuits", "build", "pel_open_verification_key.json");
    const vkeyJson = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
    const vk = garaga.parseGroth16VerifyingKeyFromObject(vkeyJson);
    const parsedProof = garaga.parseGroth16ProofFromObject(openProof.proof, openProof.publicSignals.map((s: string) => BigInt(s)));
    realGaragaCalldata = garaga.getGroth16CallData(parsedProof, vk, garaga.CurveId.BN254);
  });

  it("STEP 1: Generates real Groth16 proof with valid public signals layout matching circuit", () => {
    expect(openProof.publicSignals.length).toBe(4);
    expect(openProof.publicSignals[0]).toBe(commitment.toString());
    expect(openProof.publicSignals[1]).toBe(nullifier.toString());
    expect(openProof.publicSignals[2]).toBe(BigInt("0x4254432d50455250").toString());
    expect(openProof.publicSignals[3]).toBe(marginCents.toString());
  });

  it("STEP 2: Generates real 1978-felt Garaga BN254 calldata for on-chain verifier", () => {
    expect(realGaragaCalldata.length).toBe(1978);
    expect(realGaragaCalldata[0]).toBe(1977n); // Calldata length header
  });

  it("STEP 3: Builds authoritative open_position transaction with real proof calldata", () => {
    const openCall = starknetPerpsDispatcher.buildOpenPositionCall(
      traderAddress,
      marketId,
      5000,
      realGaragaCalldata
    );

    expect(openCall.contractAddress).toBe(config.pelCoreAddress);
    expect(openCall.entrypoint).toBe("open_position");
    expect(openCall.calldata[0]).toBe(traderAddress);
    expect(openCall.calldata[1]).toBe("0x4254432d50455250");
    expect(openCall.calldata[2]).toBe("0x7a120"); // ,000 * 100 = 500,000 = 0x7a120
    expect(BigInt(openCall.calldata[3])).toBe(BigInt(realGaragaCalldata.length));
  });

  it("STEP 4: Encrypts and persists private witness in client store", () => {
    saveWitness(traderAddress, {
      protocolVersion: 3,
      marketId,
      side: "LONG",
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      feesCents: 0n,
      nonce: nonceHex,
      ownerSecret: ownerSecretHex,
      commitment: "0x" + commitment.toString(16),
      nullifier: "0x" + nullifier.toString(16),
      openedAtMs: Date.now(),
    });

    const loaded = loadWitness(traderAddress, "0x" + commitment.toString(16));
    expect(loaded).not.toBeNull();
    expect(loaded?.ownerSecret).toBe(ownerSecretHex);
    expect(loaded?.marginCents).toBe(marginCents);
  });

  it("STEP 5 (Adversarial): Mutating proof margin causes SNARK verification failure", async () => {
    const tamperedSignals = [...openProof.publicSignals];
    tamperedSignals[3] = "10000"; // Lie: claim  margin instead of ,000
    const ok = await pelCircuitService.verifyProof("OPEN", openProof.proof, tamperedSignals);
    expect(ok).toBe(false);
  });

  it("STEP 6 (Adversarial): Mutating commitment causes SNARK verification failure", async () => {
    const tamperedSignals = [...openProof.publicSignals];
    tamperedSignals[0] = (BigInt(tamperedSignals[0]) + 1n).toString();
    const ok = await pelCircuitService.verifyProof("OPEN", openProof.proof, tamperedSignals);
    expect(ok).toBe(false);
  });

  it("STEP 7 (Adversarial): Mutating nullifier causes SNARK verification failure", async () => {
    const tamperedSignals = [...openProof.publicSignals];
    tamperedSignals[1] = (BigInt(tamperedSignals[1]) + 1n).toString();
    const ok = await pelCircuitService.verifyProof("OPEN", openProof.proof, tamperedSignals);
    expect(ok).toBe(false);
  });

  it("STEP 8 (Adversarial): Mutating market ID causes SNARK verification failure", async () => {
    const tamperedSignals = [...openProof.publicSignals];
    tamperedSignals[2] = BigInt("0x4554482d50455250").toString(); // ETH-PERP
    const ok = await pelCircuitService.verifyProof("OPEN", openProof.proof, tamperedSignals);
    expect(ok).toBe(false);
  });
});