/**
 * @file strk20SdkOnboarding.test.ts
 * @description Integration test against the ACTUAL vendored StarkWare STRK20 SDK.
 *
 * Proves, with the real SDK implementation, the protocol facts the LANE A onboarding
 * relies on:
 *   - `discoverRequirement(recipient, token)` is the authoritative readiness mechanism
 *     and reports Register → SetupChannel → SetupToken → Ready.
 *   - `autoRegister` + `autoSetup` transparently register + open channels on the first
 *     executed action (this is exactly what the Ready wallet does internally for every
 *     wallet_strk20InvokeTransaction, so "first action registers" is a documented
 *     mechanism, not a heuristic).
 *   - Registration is WriteOnce: re-running registration on an already-registered
 *     account reverts.
 *
 * Runs entirely on the SDK's Mocknet (mock pool + mock prover + contract discovery) —
 * no network, no viewing keys leaked.
 */

import { describe, it, expect } from 'vitest';
// Import the vendored SDK directly (the `testing` package index pulls in `starknet-devnet`,
// which is not installed). Mocknet + SetupRequirement are real SDK modules.
import { Mocknet } from '../../vendor/starknet-privacy-sdk/dist/testing/mocknet.js';
import { SetupRequirement } from '../../vendor/starknet-privacy-sdk/dist/interfaces.js';

describe('STRK20 SDK onboarding semantics (real SDK, mocknet)', () => {
  const mocknet = new Mocknet();
  const env = mocknet.initialize();
  const TOKEN = env.ace as string;

  it('discoverRequirement: Register → SetupChannel → SetupToken → Ready via real actions', async () => {
    const alice = mocknet.createPrivateTransfers(env.alice.address, env.alice.privateKey);
    const bob = mocknet.createPrivateTransfers(env.bob.address, env.bob.privateKey);

    // Fresh accounts: the recipient (bob) has no viewing key, so no note can be
    // encrypted to them yet.
    expect(await alice.discoverRequirement(env.bob.address, TOKEN)).toBe(SetupRequirement.Register);

    // Bob "enables private receiving": his wallet runs autoRegister+autoSetup, which
    // produces a real SetViewingKey + OpenChannel(self) action set.
    const bobReg = await bob.build({ autoRegister: true, autoSetup: true }).register().execute();
    mocknet.executeOutside(bobReg);

    // The SENDER (alice) must also be registered to open channels (her own channel
    // context is required by the compiler). Register alice too.
    const aliceReg = await alice.build({ autoRegister: true, autoSetup: true }).register().execute();
    mocknet.executeOutside(aliceReg);

    // Bob is registered; alice still has no channel to bob.
    expect(await alice.discoverRequirement(env.bob.address, TOKEN)).toBe(SetupRequirement.SetupChannel);

    // Alice opens the channel to Bob (real OpenChannel action).
    const channel = await alice.build({ autoSetup: true }).setup(env.bob.address).execute();
    mocknet.executeOutside(channel);

    expect(await alice.discoverRequirement(env.bob.address, TOKEN)).toBe(SetupRequirement.SetupToken);

    // Alice opens the per-token subchannel to Bob.
    const subchannel = await alice.build({ autoSetup: true }).with(TOKEN).setup(env.bob.address).execute();
    mocknet.executeOutside(subchannel);

    expect(await alice.discoverRequirement(env.bob.address, TOKEN)).toBe(SetupRequirement.Ready);
  });

  it('autoRegister + autoSetup registers a fresh user on their first executed action', async () => {
    const alice = mocknet.createPrivateTransfers(env.carol.address, env.carol.privateKey);
    // No explicit register() — autoRegister adds SetViewingKey because the user has no
    // channel/public key yet. This is the mechanism the wallet uses transparently.
    const first = await alice
      .build({ autoRegister: true, autoSetup: true })
      .with(TOKEN)
      .deposit({ amount: 50n })
      .execute();
    mocknet.executeOutside(first);

    // Self is now fully set up: autoRegister+autoSetup created the self-channel AND the
    // self→self token subchannel (needed for the deposited note), so readiness is Ready.
    expect(await alice.discoverRequirement(env.carol.address, TOKEN)).toBe(SetupRequirement.Ready);
  });

  it('registration is WriteOnce: re-running onboarding on a registered account reverts', async () => {
    const david = mocknet.createPrivateTransfers(env.david.address, env.david.privateKey);
    const reg = await david.build({ autoRegister: true, autoSetup: true }).register().execute();
    mocknet.executeOutside(reg);

    // Running the same onboarding again produces a SetViewingKey action, which the pool
    // rejects (viewing keys are immutable). This is exactly why the wallet-lane
    // onboarding must detect ready state and skip — getPrivateReceivingRequirement/READY.
    await expect(
      david.build({ autoRegister: true, autoSetup: true }).register().execute(),
    ).rejects.toThrow();
  });
});