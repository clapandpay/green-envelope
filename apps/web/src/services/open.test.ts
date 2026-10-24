// SPDX-License-Identifier: AGPL-3.0-or-later
// One tap on the envelope, against the real services, the real vault keystore and a software
// passkey (real P-256 signatures, no sensor). Everything it is wired into is the shipped code.
import { decodeAddress, sha256, TESTNET11 } from '@ge/chia';
import { fakePasskeys } from '@ge/passkey-signer/fake';
import { setupPuzzleHash } from '@ge/vault';
import { createVaultKeyStore, memoryVaultStorage } from '@ge/wallet';
import { describe, expect, it } from 'vitest';
import { MIN_SHARE_MOJOS } from '../lib/envelope-form';
import { createFakeChain } from '../test/fake-chain';
import { createLocalState } from './local-state';
import { createServicesFrom, DEFAULT_FEE_MOJOS, feeFromEnv } from './real';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** A browser on a phone: its own storage, and the phone's passkeys (shared between browsers). */
function browser(phone: ReturnType<typeof fakePasskeys>, fake = createFakeChain()) {
  const keyStore = createVaultKeyStore({ env: phone.env, storage: memoryVaultStorage() });
  const services = createServicesFrom({
    network: TESTNET11,
    chain: fake.chain,
    keyStore,
    state: createLocalState(memoryStorage()),
    origin: 'https://ge.test',
    fetch: async () => new Response('{}', { status: 500 }),
    now: () => 1_800_000_000,
    fee: 0n,
    expirySeconds: 7 * 86_400,
  });
  return { services, keyStore, fake };
}

describe('one tap on the envelope', () => {
  it('never makes a wallet: a phone with no passkey here is reported, not filled in', async () => {
    const phone = fakePasskeys();
    const { services } = browser(phone);
    await expect(services.wallet.open()).rejects.toMatchObject({ code: 'wallet_cancelled' });
    expect(phone.count()).toBe(0);
    expect(await services.wallet.current()).toBeNull();
  });

  it('makes one through ensure(), the step a person asks for, named with the date', async () => {
    const phone = fakePasskeys();
    const { services, keyStore } = browser(phone);
    const info = await services.wallet.ensure();
    expect(phone.count()).toBe(1);
    expect(info.kind).toBe('passkey');
    const record = await keyStore.status();
    // Before the vault exists, money is received at the setup address: the passkey alone.
    expect(decodeAddress(info.address).puzzleHash).toEqual(
      setupPuzzleHash(record?.publicKey ?? new Uint8Array()),
    );
  });

  it('opens the wallet this browser knows with no prompt at all', async () => {
    const phone = fakePasskeys();
    const { services } = browser(phone);
    const first = await services.wallet.ensure();
    const asked = phone.calls.get + phone.calls.create;
    const again = await services.wallet.open();
    expect(again.address).toBe(first.address);
    expect(phone.calls.get + phone.calls.create).toBe(asked);
  });

  it('finds the passkey wallet made in another browser, with the same address', async () => {
    const phone = fakePasskeys();
    const fake = createFakeChain();
    const here = await browser(phone, fake).services.wallet.ensure();
    // Money so the chain can tell which of the two recovered keys is the passkey's.
    fake.add({
      parentCoinInfo: sha256(new TextEncoder().encode('faucet')),
      puzzleHash: decodeAddress(here.address).puzzleHash,
      amount: 1_000_000n,
    });
    const there = await browser(phone, fake).services.wallet.open();
    expect(there.address).toBe(here.address);
    expect(phone.count()).toBe(1); // found, not made
  });

  it('finds a passkey that never held money too, with a second prompt to settle the key', async () => {
    const phone = fakePasskeys();
    const fake = createFakeChain();
    const here = await browser(phone, fake).services.wallet.ensure();
    const there = await browser(phone, fake).services.wallet.open();
    expect(there.address).toBe(here.address);
  });

  it('reports a dismissed prompt as cancelled and makes no wallet', async () => {
    const phone = fakePasskeys({ failGet: 'NotAllowedError', failCreate: 'NotAllowedError' });
    const { services } = browser(phone);
    await expect(services.wallet.ensure()).rejects.toMatchObject({ code: 'wallet_cancelled' });
    expect(await services.wallet.current()).toBeNull();
  });

  it('says passkey_unavailable where no ES256 passkey can be made, and makes nothing else', async () => {
    const phone = fakePasskeys({ noEs256: true });
    const { services } = browser(phone);
    await expect(services.wallet.ensure()).rejects.toMatchObject({ code: 'passkey_unavailable' });
    expect(await services.wallet.current()).toBeNull();
    expect('keepInBrowser' in services.wallet).toBe(false);
  });

  it('makes a new passkey in place of the current one through makeNew()', async () => {
    const phone = fakePasskeys();
    const { services } = browser(phone);
    const first = await services.wallet.ensure();
    const second = await services.wallet.makeNew();
    expect(second.address).not.toBe(first.address);
    expect(phone.count()).toBe(2); // the old passkey is still on the phone, with its money
  });
});

describe('the fee a deployment gets when it does not name one', () => {
  it('is 0.00001 TXCH on testnet, and a floor on mainnet, where the network is asked', () => {
    // A zero fee is the first thing dropped when a mempool fills, and an envelope that will
    // not open for an hour is worse than one that costs a fraction of a cent.
    expect(feeFromEnv(undefined, 'testnet11')).toBe(10_000_000n);
    expect(feeFromEnv(undefined, 'mainnet')).toBeGreaterThan(0n);
  });

  it('stays far below the smallest share, which is what pays it', () => {
    // The opener pays the fee out of their own share, so the default must be invisible next
    // to the smallest share this app will make.
    expect(DEFAULT_FEE_MOJOS.mainnet * 100n).toBeLessThan(MIN_SHARE_MOJOS);
  });

  it('takes what the deployment says', () => {
    expect(feeFromEnv('25', 'mainnet')).toBe(25n);
    expect(feeFromEnv('0', 'mainnet')).toBe(0n); // deliberately zero is allowed
  });

  it('ignores a typo rather than taking the app down with it', () => {
    for (const bad of ['', '  ', 'lots', '-5', '1.5', '1e6']) {
      expect(feeFromEnv(bad, 'mainnet'), bad).toBe(DEFAULT_FEE_MOJOS.mainnet);
    }
  });
});
