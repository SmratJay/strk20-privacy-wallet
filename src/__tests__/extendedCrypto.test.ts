/**
 * @file src/__tests__/extendedCrypto.test.ts
 * @description Verifies the Extended crypto primitives against the official Rust reference
 * vectors from x10xchange/rust-crypto-lib-base (the crate the official Python SDK wraps).
 */

import { describe, it, expect } from 'vitest';
import {
  domainHash,
  encodeShortString,
  orderHash,
  orderMessageHash,
  pedersen,
  poseidonHashMany,
  privateKeyFromEthSignature,
  selector,
  starkKeyOf,
  starkSign,
  toFelt,
  withdrawalArgsHash,
  withdrawalMessageHash,
} from '../extended/crypto';
import { ec } from 'starknet';

const curve = ec.starkCurve;
const FIELD = curve.Fp251.ORDER;

const MESSAGE_FELT = encodeShortString('StarkNet Message');

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 };

describe('extended crypto primitives', () => {
  it('matches the StarkNetDomain selector', () => {
    const got = selector(
      '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
    );
    expect('0x' + got.toString(16)).toBe('0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210');
  });

  it('matches the Order selector', () => {
    const got = selector(
      '"Order"("position_id":"felt","base_asset_id":"AssetId","base_amount":"i64","quote_asset_id":"AssetId","quote_amount":"i64","fee_asset_id":"AssetId","fee_amount":"u64","expiration":"Timestamp","salt":"felt")"PositionId"("value":"u32")"AssetId"("value":"felt")"Timestamp"("seconds":"u64")',
    );
    expect('0x' + got.toString(16)).toBe('0x36da8d51815527cabfaa9c982f564c80fa7429616739306036f1f9b608dd112');
  });

  it('matches the StarkNetDomain hash (Perpetuals/v0/SN_SEPOLIA/1)', () => {
    expect(domainHash(DOMAIN).toString()).toBe(
      '2788850828067604540663615870177667078542240404906059806659101905868929188327',
    );
  });

  it('matches the Order struct hash vector', () => {
    const got = orderHash({
      positionId: 1,
      baseAssetId: 2,
      baseAmount: 3n,
      quoteAssetId: 4,
      quoteAmount: 5n,
      feeAssetId: 6,
      feeAmount: 7n,
      expiration: 8n,
      salt: 9n,
    });
    expect(got.toString()).toBe('1329353150252109345267997901008558234696410103652961347079636617692652241760');
  });

  it('matches the Order message hash vector', () => {
    const oh = orderHash({
      positionId: 1,
      baseAssetId: 2,
      baseAmount: 3n,
      quoteAssetId: 4,
      quoteAmount: 5n,
      feeAssetId: 6,
      feeAmount: 7n,
      expiration: 8n,
      salt: 9n,
    });
    const got = orderMessageHash(
      {
        positionId: 1,
        baseAssetId: 2,
        baseAmount: 3n,
        quoteAssetId: 4,
        quoteAmount: 5n,
        feeAssetId: 6,
        feeAmount: 7n,
        expiration: 8n,
        salt: 9n,
      },
      1528491859474308181214583355362479091084733880193869257167008343298409336538n,
      DOMAIN,
    );
    expect(oh).toBeTruthy();
    expect(got.toString()).toBe('2788960362996410178586013462192086205585543858281504820767681025777602529597');
  });

  it('matches the full get_order_hash reference vector (signed amounts)', () => {
    const got = orderMessageHash(
      {
        positionId: 100,
        baseAssetId: '0x2',
        baseAmount: 100n,
        quoteAssetId: '0x1',
        quoteAmount: -156n,
        feeAssetId: '0x1',
        feeAmount: 74n,
        expiration: 100n,
        salt: 123n,
      },
      '0x5d05989e9302dcebc74e241001e3e3ac3f4402ccf2f8e6f74b034b07ad6a904',
      DOMAIN,
    );
    expect('0x' + got.toString(16)).toBe('0x4de4c009e0d0c5a70a7da0e2039fb2b99f376d53496f89d9f437e736add6b48');
  });

  it('derives the L2 private key from an ETH signature (grindKey over r)', () => {
    const sig =
      '0x9ef64d5936681edf44b4a7ad713f3bc24065d4039562af03fccf6a08d6996eab367df11439169b417b6a6d8ce81d409edb022597ce193916757c7d5d9cbf97301c';
    const priv = privateKeyFromEthSignature(sig);
    expect(BigInt('0x' + priv).toString()).toBe(
      '3554363360756768076148116215296798451844584215587910826843139626172125285444',
    );
    expect(starkKeyOf('0x' + priv)).toBe('0x78298687996aff29a0bbcb994e1305db082d084f85ec38bb78c41e6787740ec');
  });

  it('encodes short strings like cairo_short_string_to_felt', () => {
    expect(encodeShortString('Perpetuals')).toBe(
      BigInt('0x50657270657475616c73'),
    );
  });

  it('wraps negative i64 into a field element', () => {
    expect(toFelt(-156n)).toBe(((-156n % FIELD) + FIELD) % FIELD);
    expect(toFelt(156n)).toBe(156n);
  });

  it('signs and verifies a message on the Stark curve', () => {
    const priv = '0x' + 123456789n.toString(16);
    const pub = starkKeyOf(priv);
    const msg = '0xdeadbeef';
    const sig = starkSign(BigInt(msg), priv);
    const ok = curve.verify(
      new curve.Signature(BigInt(sig.r), BigInt(sig.s)),
      msg,
      curve.getPublicKey(priv),
    );
    expect(ok).toBe(true);
    expect(pub).toBe(starkKeyOf(priv));
  });

  it('computes pedersen hash', () => {
    const got = pedersen(1n, 2n);
    expect('0x' + got.toString(16)).toBe(
      '0x5bb9440e27889a364bcb678b1f679ecd1347acdedcbf36e83494f857cc58026',
    );
  });

  it('poseidonHashMany matches hash.computePoseidonHashOnElements', () => {
    expect(poseidonHashMany([1n, 2n, 3n])).toBe(BigInt(curve.poseidonHashMany([1n, 2n, 3n])));
  });

  it('matches the WithdrawArgs selector', () => {
    // Official Rust reference: x10xchange/rust-crypto-lib-base starknet_messages.rs
    const selectorValue = selector(
      '"WithdrawArgs"("recipient":"ContractAddress","position_id":"PositionId","collateral_id":"AssetId","amount":"u64","expiration":"Timestamp","salt":"felt")"PositionId"("value":"u32")"AssetId"("value":"felt")"Timestamp"("seconds":"u64")',
    );
    expect('0x' + selectorValue.toString(16)).toBe(
      '0x250a5fa378e8b771654bd43dcb34844534f9d1e29e16b14760d7936ea7f4b1d',
    );
  });

  it('matches the WithdrawArgs struct hash vector', () => {
    const hashValue = withdrawalArgsHash({
      recipient: '0x019ec96d4aea6fdc6f0b5f393fec3f186aefa8f0b8356f43d07b921ff48aa5da',
      positionId: 1,
      collateralId: 4,
      amount: 1000n,
      expiration: 5n,
      salt: 123n,
    });
    // Normalize both sides by the field prime to ignore leading-zero formatting.
    const expected = BigInt('0x04c22f625c59651e1219c60d03055f11f5dc23959929de35861548d86c0bc4ec');
    expect(hashValue).toBe(expected);
  });

  it('matches the WithdrawArgs message hash (SNIP-12 domain)', () => {
    // Recompute with the SN_SEPOLIA domain, mirroring the Rust OffChainMessage test.
    const messageHash = withdrawalMessageHash(
      {
        recipient: '0x019ec96d4aea6fdc6f0b5f393fec3f186aefa8f0b8356f43d07b921ff48aa5da',
        positionId: 1,
        collateralId: 4,
        amount: 1000n,
        expiration: 5n,
        salt: 123n,
      },
      '0x01', // placeholder public key — verifies internal consistency only
      { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 },
    );
    expect(messageHash).toBe(
      BigInt(curve.poseidonHashMany([
        MESSAGE_FELT,
        domainHash({ name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 }),
        BigInt('0x01'),
        withdrawalArgsHash({
          recipient: '0x019ec96d4aea6fdc6f0b5f393fec3f186aefa8f0b8356f43d07b921ff48aa5da',
          positionId: 1,
          collateralId: 4,
          amount: 1000n,
          expiration: 5n,
          salt: 123n,
        }),
      ])),
    );
  });
});
