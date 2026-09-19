// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './bytes';
import { deserialize, treeHash } from './clvm';
import { ChiaError } from './errors';
import { keyGen, publicKey } from './keys';
import { MAINNET, TESTNET11 } from './network';
import {
  DEFAULT_HIDDEN_PUZZLE_HASH_HEX,
  STANDARD_MOD_HASH_HEX,
  STANDARD_MOD_HEX,
  standardPuzzleHash,
  standardPuzzleReveal,
  syntheticPublicKey,
  syntheticSecretKey,
} from './standard';
import { loadVectors } from './test-vectors';

const vectors = loadVectors();

describe('constants', () => {
  it('the embedded mod is the SDK’s and hashes to the known mod hash', () => {
    expect(STANDARD_MOD_HEX).toBe(vectors.constants.standard_mod_reveal);
    expect(STANDARD_MOD_HASH_HEX).toBe(vectors.constants.standard_mod_hash);
    expect(toHex(treeHash(deserialize(fromHex(STANDARD_MOD_HEX))))).toBe(STANDARD_MOD_HASH_HEX);
  });

  it('the default hidden puzzle hash is the SDK’s, and is the tree hash of (=)', () => {
    expect(DEFAULT_HIDDEN_PUZZLE_HASH_HEX).toBe(vectors.constants.default_hidden_puzzle_hash);
    // (=) serializes as ff0980
    expect(toHex(treeHash(deserialize(fromHex('ff0980'))))).toBe(DEFAULT_HIDDEN_PUZZLE_HASH_HEX);
  });

  it('networks carry the SDK’s genesis challenges as AGG_SIG_ME extra data', () => {
    const c = vectors.constants;
    expect(toHex(MAINNET.aggSigMeExtraData)).toBe(c.mainnet_agg_sig_me_extra_data);
    expect(toHex(MAINNET.aggSigMeExtraData)).toBe(c.mainnet_genesis_challenge);
    expect(toHex(TESTNET11.aggSigMeExtraData)).toBe(c.testnet11_agg_sig_me_extra_data);
    expect(toHex(TESTNET11.aggSigMeExtraData)).toBe(c.testnet11_genesis_challenge);
    expect([MAINNET.name, MAINNET.addressPrefix]).toEqual(['mainnet', 'xch']);
    expect([TESTNET11.name, TESTNET11.addressPrefix]).toEqual(['testnet11', 'txch']);
  });
});

describe.each(vectors.keys)('golden vectors: seed $seed', (v) => {
  it('synthetic keys', () => {
    expect(toHex(syntheticSecretKey(fromHex(v.master_sk)))).toBe(v.synthetic_sk);
    expect(toHex(syntheticPublicKey(fromHex(v.master_pk)))).toBe(v.synthetic_pk);
  });

  it('puzzle hash and reveal', () => {
    const reveal = standardPuzzleReveal(fromHex(v.synthetic_pk));
    expect(toHex(standardPuzzleHash(fromHex(v.synthetic_pk)))).toBe(v.puzzle_hash);
    expect(toHex(reveal)).toBe(v.puzzle_reveal);
    expect(toHex(treeHash(deserialize(reveal)))).toBe(v.puzzle_hash);
  });

  it.each(v.wallet)('wallet address $index puzzle hash', (w) => {
    const pk = syntheticPublicKey(fromHex(w.unhardened_pk));
    expect(toHex(standardPuzzleHash(pk))).toBe(w.puzzle_hash);
  });
});

describe('properties', () => {
  it('synthetic secret and public keys correspond; shortcut hash equals the reveal’s hash', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (seed) => {
        const sk = keyGen(seed);
        const syntheticPk = syntheticPublicKey(publicKey(sk));
        expect(publicKey(syntheticSecretKey(sk))).toEqual(syntheticPk);
        expect(treeHash(deserialize(standardPuzzleReveal(syntheticPk)))).toEqual(
          standardPuzzleHash(syntheticPk),
        );
      }),
      { numRuns: 15 },
    );
  });
});

describe('error paths', () => {
  it('rejects keys of the wrong length', () => {
    expect(() => standardPuzzleHash(new Uint8Array(47))).toThrowError(ChiaError);
    expect(() => standardPuzzleReveal(new Uint8Array(49))).toThrowError(ChiaError);
    expect(() => syntheticPublicKey(new Uint8Array(32))).toThrowError(ChiaError);
    expect(() => syntheticSecretKey(new Uint8Array(48))).toThrowError(ChiaError);
  });
});
