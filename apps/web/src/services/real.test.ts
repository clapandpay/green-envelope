// SPDX-License-Identifier: AGPL-3.0-or-later
import { decodeAddress, MAINNET, sha256, TESTNET11 } from '@ge/chia';
import { decodeLink, encodeLink, envelopeKeys } from '@ge/envelope';
import { fakePasskeys } from '@ge/passkey-signer/fake';
import { createVaultKeyStore, memoryVaultStorage, type VaultKeyStore } from '@ge/wallet';
import { describe, expect, it, vi } from 'vitest';
import { createFakeChain } from '../test/fake-chain';
import { createLocalState } from './local-state';
import { createServicesFrom, priceIn, servedChain } from './real';
import type { AppServices } from './types';

const text = (s: string) => new TextEncoder().encode(s);

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** The real vault keystore over a software passkey: one per person, as one phone each. */
function keyStoreFor(): VaultKeyStore {
  return createVaultKeyStore({ env: fakePasskeys().env, storage: memoryVaultStorage() });
}

function world(fee = 0n) {
  const fake = createFakeChain();
  const person = (_name: string): AppServices =>
    createServicesFrom({
      network: TESTNET11,
      chain: fake.chain,
      keyStore: keyStoreFor(),
      state: createLocalState(memoryStorage()),
      origin: 'https://clapandpay.test',
      fetch: async () => new Response('{}', { status: 500 }),
      now: () => 1_800_000_000,
      fee,
      expirySeconds: 7 * 86_400,
      waiting: {
        intervalMs: 1,
        timeoutMs: 2_000,
        sleep: () => new Promise((r) => setTimeout(r, 1)),
      },
    });
  return { fake, person };
}

async function addressOf(who: AppServices): Promise<string> {
  return (await who.wallet.ensure()).address;
}

async function fund(fake: ReturnType<typeof createFakeChain>, who: AppServices, amount: bigint) {
  const { address } = await who.wallet.ensure();
  fake.add({
    parentCoinInfo: sha256(text(`faucet ${address} ${amount}`)),
    puzzleHash: decodeAddress(address).puzzleHash,
    amount,
  });
}

describe('the whole loop', () => {
  it('Anna sends 5 shares, the family opens them, everybody ends up with the right money', async () => {
    const { fake, person } = world();
    const anna = person('anna');
    await fund(fake, anna, 2_000_000_000n);

    const sent = await anna.envelopes.create({
      total: 1_000_000_000n,
      shares: 5,
      mode: 'random',
      from: 'Anna',
      message: 'Happy birthday',
    });
    expect(sent.status).toBe('pending');
    expect(decodeLink(sent.link)).toMatchObject({ shares: 5, from: 'Anna' });

    // The link is in the chat before the network has the envelope.
    const kai = person('kai');
    await expect(kai.envelopes.inspect(sent.link)).rejects.toMatchObject({
      code: 'envelope_not_ready',
    });

    fake.farmBlock();
    // The outgoing amount stops counting as pending once the next poll sees the envelope.
    await vi.waitFor(async () =>
      // Her first spend launched her vault: 1 mojo is the vault itself, not money.
      expect(await anna.wallet.balance()).toEqual({ confirmed: 999_999_999n, pending: 0n }),
    );
    expect(await kai.envelopes.inspect(sent.link)).toMatchObject({
      from: 'Anna',
      message: 'Happy birthday',
      sharesTotal: 5,
      sharesLeft: 5,
      openedAmount: null,
    });

    // Everybody taps within the same block.
    const family = ['kai', 'ben', 'chris', 'dana', 'eli'].map(person);
    const opened = await Promise.all(family.map((p) => p.envelopes.open(sent.link)));
    // Each first claim also launched that person's vault: 1 mojo each, out of the share.
    expect(opened.reduce((sum, o) => sum + o.amount, 0n)).toBe(1_000_000_000n - 5n);

    const late = person('late');
    await expect(late.envelopes.open(sent.link)).rejects.toMatchObject({ code: 'envelope_empty' });

    fake.farmBlock();
    await Promise.all(opened.map((o) => o.confirmed));
    for (const [at, p] of family.entries()) {
      expect((await p.wallet.balance()).confirmed).toBe(opened[at]?.amount);
    }

    const [listed] = await anna.envelopes.listSent();
    expect(listed).toMatchObject({
      status: 'finished',
      sharesOpened: 5,
      amountOpened: 1_000_000_000n,
    });
  });

  it('remembers what this browser opened and refuses a second share', async () => {
    const { fake, person } = world();
    const anna = person('anna');
    await fund(fake, anna, 500_000n);
    const sent = await anna.envelopes.create({
      total: 400_000n,
      shares: 2,
      mode: 'equal',
      from: null,
      message: null,
    });
    fake.farmBlock();

    const kai = person('kai');
    const first = await kai.envelopes.open(sent.link);
    // Kai's first claim also launched his vault, out of the share: 1 mojo.
    expect(first.amount).toBe(200_000n - 1n);
    await expect(kai.envelopes.open(sent.link)).rejects.toMatchObject({ code: 'already_opened' });
    expect((await kai.envelopes.inspect(sent.link)).openedAmount).toBe(200_000n - 1n);
  });

  it('takes back what nobody opened, with the fee paid by the shares', async () => {
    const { fake, person } = world(1_000n);
    const anna = person('anna');
    await fund(fake, anna, 10_000_000n);
    const sent = await anna.envelopes.create({
      total: 6_000_000n,
      shares: 3,
      mode: 'equal',
      from: 'Anna',
      message: null,
    });
    fake.farmBlock();

    const kai = person('kai');
    const opened = await kai.envelopes.open(sent.link);
    expect(opened.amount).toBe(2_000_000n - 1_000n - 1n); // and Kai's vault
    fake.farmBlock();

    const back = await anna.envelopes.takeBack(sent.id);
    expect(back.amount).toBe(4_000_000n - 1_000n);
    fake.farmBlock();
    await back.confirmed;

    // 10M - 6M - create fee - her vault + 4M - take-back fee
    expect((await anna.wallet.balance()).confirmed).toBe(
      10_000_000n - 6_000_000n - 1_000n - 1n + 3_999_000n,
    );
    const [listed] = await anna.envelopes.listSent();
    expect(listed).toMatchObject({
      status: 'taken_back',
      sharesOpened: 1,
      amountOpened: 2_000_000n,
    });
    await expect(person('late').envelopes.open(sent.link)).rejects.toMatchObject({
      code: 'envelope_empty',
    });
  });

  it('sends on to an address, and refuses the wrong network and too much', async () => {
    const { fake, person } = world();
    const kai = person('kai');
    const anna = person('anna');
    await fund(fake, kai, 9_000n);
    const { address } = await anna.wallet.ensure();

    const sending = await kai.wallet.send(address, 4_000n);
    expect((await kai.wallet.balance()).pending).toBe(-4_000n);
    fake.farmBlock();
    await sending.confirmed;
    expect(await kai.wallet.balance()).toEqual({ confirmed: 4_999n, pending: 0n }); // vault: 1
    expect((await anna.wallet.balance()).confirmed).toBe(4_000n);

    await expect(kai.wallet.send(address.replace(/^txch/, 'xch'), 1n)).rejects.toMatchObject({
      code: 'invalid_recipient',
    });
    // These tests run on testnet11, where the handle registry does not exist. Saying so is
    // different advice from "check the spelling".
    await expect(kai.wallet.send('@anna', 1n)).rejects.toMatchObject({
      code: 'handles_mainnet_only',
    });
    await expect(kai.wallet.send(address, 5_000n)).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
  });

  it('never prompts for a balance and reports no wallet before the first use', async () => {
    const { person } = world();
    const nobody = person('nobody');
    expect(await nobody.wallet.current()).toBeNull();
    expect(await nobody.wallet.balance()).toEqual({ confirmed: 0n, pending: 0n });
    expect(await nobody.envelopes.listSent()).toEqual([]);
  });

  it('gives a sender distinct envelopes', async () => {
    const { fake, person } = world();
    const anna = person('anna');
    await fund(fake, anna, 1_000_000n);
    const input = { total: 100_000n, shares: 1, mode: 'equal', from: null, message: null } as const;
    const a = await anna.envelopes.create(input);
    fake.farmBlock();
    const b = await anna.envelopes.create(input);
    expect(a.id).not.toBe(b.id);
    expect((await anna.envelopes.listSent()).map((e) => e.id)).toEqual([b.id, a.id]);
  });
});

describe('two networks in one browser', () => {
  it('lists only the envelopes of the network in use', async () => {
    const storage = memoryStorage();
    const state = createLocalState(storage);
    const record = (id: string, link: string) => ({
      id,
      counter: 0,
      link,
      createdAt: 0,
      total: '1000',
      shares: 1,
      takenBack: null,
    });
    const link = (label: string) => {
      const secret = sha256(text(label)).slice(0, 16);
      return encodeLink('https://ge.test', { publicKey: envelopeKeys(secret).publicKey, secret });
    };
    state.addSent(record('on-main', link('main')));
    const test = new URL(link('test'));
    test.searchParams.set('net', 'testnet');
    state.addSent(record('on-test', test.toString()));
    const services = (network: typeof TESTNET11) =>
      createServicesFrom({
        network,
        chain: createFakeChain().chain,
        keyStore: keyStoreFor(),
        state,
        origin: 'https://ge.test',
        fetch: async () => new Response('{}', { status: 500 }),
        now: () => 0,
        fee: 0n,
        expirySeconds: 1,
      });
    const ids = async (network: typeof TESTNET11) =>
      (
        await services(network)
          .envelopes.listSent()
          .catch(() => [])
      ).map((e) => e.id);
    expect(await ids(TESTNET11)).toEqual(['on-test']);
    expect(await ids(MAINNET)).toEqual(['on-main']);
  });
});

describe('moving to Klimper', () => {
  it('sends everything to a Klimper address with one prompt, and refuses another network', async () => {
    const { fake, person } = world(1_000n);
    const kai = person('kai');
    await fund(fake, kai, 2_000_000n);
    // The first spend from setup money also launches the vault.
    await kai.wallet.send(await addressOf(person('lea')), 100_000n);
    fake.farmBlock();
    const before = (await kai.wallet.balance()).confirmed;
    expect(before).toBe(2_000_000n - 100_000n - 1_000n - 1n);

    const klimper = await addressOf(person('klimper'));
    await expect(
      kai.wallet.moveToKlimper('xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'),
    ).rejects.toMatchObject({
      code: 'invalid_recipient',
    });
    const moved = await kai.wallet.moveToKlimper(klimper);
    expect(moved.amount).toBe(before - 1_000n);
    expect(moved.more).toBe(false);
    fake.farmBlock();
    await moved.confirmed;
    expect((await kai.wallet.balance()).confirmed).toBe(0n);
    expect(fake.balanceOf(decodeAddress(klimper).puzzleHash)).toBe(before - 1_000n);
  });
});

describe('priceIn', () => {
  it('reads both sources and rejects nonsense', () => {
    expect(priceIn({ eur: 12.5, at: 1 })).toBe(12.5);
    expect(priceIn({ chia: { eur: 9.1 } })).toBe(9.1);
    for (const bad of [null, {}, { eur: '12' }, { eur: 0 }, { eur: Number.NaN }, { chia: {} }]) {
      expect(priceIn(bad)).toBeNull();
    }
  });
});

describe('servedChain', () => {
  const doc = (content: string | null) => ({
    querySelector: () => (content === null ? null : { getAttribute: () => content }),
  });
  it('reads the server’s node for this network only, and nothing malformed', () => {
    const tag = JSON.stringify({
      network: 'mainnet',
      endpoints: ['https://api.nodexch.com', 'javascript:alert(1)'],
      apiKey: 'pk',
    });
    expect(servedChain(doc(tag) as never, 'mainnet')).toEqual({
      endpoints: ['https://api.nodexch.com'],
      apiKey: 'pk',
    });
    expect(servedChain(doc(tag) as never, 'testnet11')).toBeNull();
    expect(servedChain(doc('not json') as never, 'mainnet')).toBeNull();
    expect(servedChain(doc(null) as never, 'mainnet')).toBeNull();
  });
});
