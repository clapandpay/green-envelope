// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Coin } from '@ge/chia';
import { coinId, toHex } from '@ge/chia';
import { buildVaultSpend, launchVault } from '@ge/vault';
import { describe, expect, it } from 'vitest';
import { fakePasskeys } from './fake';
import {
  candidateKeys,
  createPasskey,
  findPasskey,
  narrowKey,
  type RelyingParty,
  signChallenge,
} from './signer';

const rp: RelyingParty = { rpId: undefined, rpName: 'Green Envelope' };

describe('a passkey as a signer', () => {
  it('makes an ES256 passkey and hands out only its public key', async () => {
    const fake = fakePasskeys();
    const passkey = await createPasskey(fake.env, rp, 'Clap and Pay wallet');
    expect(passkey.publicKey).toHaveLength(33);
    expect([2, 3]).toContain(passkey.publicKey[0]);
    expect(Object.keys(passkey).sort()).toEqual(['credentialId', 'publicKey']);
  });

  it('refuses an authenticator without ES256, so no unusable wallet is made', async () => {
    const fake = fakePasskeys({ noEs256: true });
    await expect(createPasskey(fake.env, rp, 'x')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('a dismissed prompt is "cancelled"', async () => {
    const fake = fakePasskeys({ failCreate: 'NotAllowedError' });
    await expect(createPasskey(fake.env, rp, 'x')).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('signs a vault spend that the vault builder accepts', async () => {
    const fake = fakePasskeys();
    const { credentialId, publicKey } = await createPasskey(fake.env, rp, 'x');
    const launch = launchVault(new Uint8Array(32).fill(1), publicKey);
    const money: Coin = {
      parentCoinInfo: new Uint8Array(32).fill(2),
      puzzleHash: launch.moneyPuzzleHash,
      amount: 1_000n,
    };
    const unsigned = buildVaultSpend({
      vault: launch.vault,
      money: [money],
      outputs: [{ puzzleHash: new Uint8Array(32).fill(3), amount: 600n }],
      fee: 10n,
    });
    const { assertion } = await signChallenge(fake.env, rp, unsigned.challenge, credentialId);
    const bundle = unsigned.finish(assertion);
    expect(bundle.coinSpends.map((s) => toHex(coinId(s.coin)))).toContain(toHex(coinId(money)));
  });

  it('finds an existing passkey and recovers its key, with a second prompt only to settle it', async () => {
    const fake = fakePasskeys();
    const made = await createPasskey(fake.env, rp, 'x');
    const found = await findPasskey(fake.env, rp);
    expect(toHex(found.credentialId)).toBe(toHex(made.credentialId));
    expect(found.candidates.map(toHex)).toContain(toHex(made.publicKey));
    const key = await narrowKey(fake.env, rp, found.credentialId, found.candidates);
    expect(toHex(key)).toBe(toHex(made.publicKey));
  });

  it('a phone without passkeys for this site says "cancelled", like WebAuthn does', async () => {
    const fake = fakePasskeys();
    await expect(findPasskey(fake.env, rp)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('recovers at most two candidates from one signature', async () => {
    const fake = fakePasskeys();
    const { credentialId } = await createPasskey(fake.env, rp, 'x');
    const { assertion } = await signChallenge(fake.env, rp, new Uint8Array(32), credentialId);
    expect(candidateKeys(assertion).length).toBeLessThanOrEqual(2);
  });
});
