// SPDX-License-Identifier: AGPL-3.0-or-later
// A version 2 wallet against the reference: `mnemonic-vectors.json` is written by
// `tools/vectors` (`cargo run -- mnemonic`) with the hkdf crate, the bip39 crate Klimper uses and
// chia-bls, the way Sage imports 24 words. Nothing here computes what it checks against.
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { fromHex, MAINNET, publicKey, TESTNET11, toHex } from '@ge/chia';
import { describe, expect, it } from 'vitest';
import { accountFromSeed, masterSecretKey } from './account';
import { createKeyStore } from './keystore';
import { ENTROPY_BYTES, mnemonicFromEntropy, seedFromEntropy } from './mnemonic';
import vectors from './mnemonic-vectors.json';
import { entropyFromPrf, MNEMONIC_INFO_TAG } from './passkey';
import { parseStoredWallet, type StoredWallet } from './storage';
import { fakeAuthenticator, fakeEnv } from './test-helpers';

describe('the 24 words, against the Rust reference', () => {
  it('uses the same HKDF info as the generator', () => {
    expect(vectors.info).toBe(MNEMONIC_INFO_TAG);
    expect(vectors.wallets.length).toBeGreaterThanOrEqual(5);
  });

  it.each(vectors.wallets)('PRF $prf', async (wallet) => {
    const entropy = await entropyFromPrf(fakeEnv(null), new Uint8Array(fromHex(wallet.prf)));
    expect(toHex(entropy)).toBe(wallet.entropy);

    const words = mnemonicFromEntropy(entropy);
    expect(words).toBe(wallet.mnemonic);
    expect(words.split(' ')).toHaveLength(24);

    const seed = await seedFromEntropy(entropy);
    expect(toHex(seed)).toBe(wallet.seed);
    expect(toHex(publicKey(masterSecretKey(seed)))).toBe(wallet.master_pk);

    const onMainnet = accountFromSeed(seed, MAINNET);
    expect(toHex(onMainnet.puzzleHash)).toBe(wallet.first_puzzle_hash);
    expect(onMainnet.address).toBe(wallet.first_address_xch);
    expect(accountFromSeed(seed, TESTNET11).address).toBe(wallet.first_address_txch);
  });
});

describe('BIP-39 itself', () => {
  it('matches the published vector for all-zero entropy, and node for the seed', async () => {
    const zero = new Uint8Array(ENTROPY_BYTES);
    const words = mnemonicFromEntropy(zero);
    expect(words).toBe(`${'abandon '.repeat(23)}art`);
    // BIP-39: PBKDF2-HMAC-SHA512(words, "mnemonic" + passphrase, 2048), passphrase empty.
    const expected = pbkdf2Sync(words, 'mnemonic', 2048, 64, 'sha512').toString('hex');
    expect(toHex(await seedFromEntropy(zero))).toBe(expected);
  });

  it('refuses entropy that is not 32 bytes', () => {
    expect(() => mnemonicFromEntropy(new Uint8Array(16))).toThrow(RangeError);
  });

  it('derives the entropy by HKDF-SHA256 with an empty salt and its own info', async () => {
    const prf = new Uint8Array(32).fill(9);
    const entropy = await entropyFromPrf(fakeEnv(null), prf.slice());
    const prk = createHmac('sha256', new Uint8Array(32)).update(prf).digest();
    const okm = createHmac('sha256', prk)
      .update(MNEMONIC_INFO_TAG)
      .update(Uint8Array.of(1))
      .digest();
    expect(toHex(entropy)).toBe(okm.toString('hex'));
  });
});

describe('version 2 passkey wallets in the keystore', () => {
  it('gives the words and their seed, the same on every unlock', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth) });
    const created = await store.create();
    const entropy = created.entropy ?? new Uint8Array();
    expect(toHex(created.seed)).toBe(toHex(await seedFromEntropy(entropy)));

    const opened = await store.unlock();
    expect(opened.version).toBe(2);
    expect(toHex(opened.entropy ?? new Uint8Array())).toBe(toHex(entropy));
    expect(toHex(opened.seed)).toBe(toHex(created.seed));
  });

  it('names the passkey with the label it is given', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    await createKeyStore({ env: fakeEnv(auth), rpName: 'Clap and Pay' }).create({
      label: 'Clap and Pay wallet, 9 Oct 2026',
    });
    const user = auth.calls.create[0]?.publicKey?.user;
    expect(user?.name).toBe('Clap and Pay wallet, 9 Oct 2026');
    expect(user?.displayName).toBe('Clap and Pay wallet, 9 Oct 2026');
  });

  it('opens a version 1 record as the 24-word wallet and hands over the old seed (TASK-128)', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const env = fakeEnv(auth);
    const made = await createKeyStore({ env }).create();
    expect(made.earlierSeed).toBeUndefined(); // a passkey made just now never held one
    const { indexedDbStorage } = await import('./storage');
    const storage = indexedDbStorage(env.indexedDB);
    const record = await storage.load();
    if (record?.kind !== 'passkey') throw new Error('expected a passkey record');
    // What a browser from before 24 words has: the same passkey, a version 1 record.
    await storage.save({ ...record, version: 1 });

    const opened = await createKeyStore({ env }).unlock();
    expect(opened.version).toBe(2);
    expect(toHex(opened.seed)).toBe(toHex(made.seed)); // the same 24-word wallet
    expect(opened.earlierSeed).toHaveLength(32);
    expect((await storage.load())?.version).toBe(2); // rewritten, nothing lost

    // The earlier seed is the version 1 seed, the same on every unlock and from sign-in.
    const again = await createKeyStore({ env }).unlock();
    expect(toHex(again.earlierSeed ?? new Uint8Array())).toBe(
      toHex(opened.earlierSeed ?? new Uint8Array()),
    );
    const elsewhere = await createKeyStore({ env: fakeEnv(auth), storage: memory() }).signIn();
    expect(toHex(elsewhere.earlierSeed ?? new Uint8Array())).toBe(
      toHex(opened.earlierSeed ?? new Uint8Array()),
    );
  });
});

function memory() {
  let record: StoredWallet | null = null;
  return {
    load: async () => record,
    save: async (wallet: StoredWallet) => {
      record = wallet;
    },
    clear: async () => {
      record = null;
    },
  };
}
