// SPDX-License-Identifier: AGPL-3.0-or-later
// The whole loop on the real testnet11: create, five simultaneous opens, take back (TASK-038).
// Needs test coins. Run `pnpm e2e:testnet` once to see the sender's address, fund it from
// https://testnet11-faucet.chia.net, and run it again. `GE_E2E_SEED` picks another sender.
import { createChainClient } from '@ge/chain';
import { sha256, TESTNET11 } from '@ge/chia';
import type { KeyStore } from '@ge/wallet';
import { expect, it } from 'vitest';
import { createLocalState } from './local-state';
import { createServicesFrom } from './real';

const text = (s: string) => new TextEncoder().encode(s);
const run = process.env.GE_E2E_SEED ?? 'green-envelope e2e sender v1';
const FEE = 0n;
const TOTAL = 50_000_000n; // 0.00005 TXCH

function person(name: string) {
  const seed = () => sha256(text(`${run}:${name}`));
  let exists = false;
  const keyStore: KeyStore = {
    status: async () => (exists ? { kind: 'device' as const, restorable: false } : null),
    passkeySupported: async () => false,
    create: async () => {
      exists = true;
      return { kind: 'device', seed: seed() };
    },
    unlock: async () => ({ kind: 'device', seed: seed() }),
    signIn: async () => ({ kind: 'device', seed: seed() }),
    importWallet: async (imported: Uint8Array) => {
      exists = true;
      return { kind: 'device' as const, seed: new Uint8Array(imported) };
    },
    secureWithPasskey: async () => ({ kind: 'passkey' as const, seed: seed() }),
    forget: async () => {},
  };
  const memory = new Map<string, string>();
  return createServicesFrom({
    network: TESTNET11,
    chain: createChainClient({ endpoints: ['https://testnet11.api.coinset.org'] }),
    keyStore,
    state: createLocalState({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    }),
    origin: 'https://clapandpay.com',
    fetch,
    now: () => Math.floor(Date.now() / 1000),
    fee: FEE,
    expirySeconds: 7 * 86_400,
  });
}

const say = (line: string) => process.stdout.write(`${line}\n`);
const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`;

it('create, five simultaneous opens, take back', async () => {
  const sender = person('sender');
  const { address } = await sender.wallet.ensure();
  const { confirmed } = await sender.wallet.balance();
  say(`sender ${address} has ${confirmed} mojos`);
  if (confirmed < TOTAL * 2n) {
    say(`Fund ${address} at https://testnet11-faucet.chia.net and run again.`);
    return;
  }

  // Six shares, five claimers: one share is left to take back.
  let at = Date.now();
  const sent = await sender.envelopes.create({
    total: TOTAL,
    shares: 6,
    mode: 'random',
    from: 'e2e',
    message: null,
  });
  say(`created in ${seconds(at)}: ${sent.link}`);

  at = Date.now();
  await expect
    .poll(async () => (await sender.envelopes.listSent())[0]?.status, {
      timeout: 10 * 60_000,
      interval: 5_000,
    })
    .toBe('active');
  say(`envelope on chain after ${seconds(at)}`);

  at = Date.now();
  const claimers = ['a', 'b', 'c', 'd', 'e'].map((name) => person(`claimer ${name} ${Date.now()}`));
  const opened = await Promise.all(claimers.map((c) => c.envelopes.open(sent.link)));
  say(`five amounts on screen after ${seconds(at)}: ${opened.map((o) => o.amount).join(', ')}`);

  at = Date.now();
  await Promise.all(opened.map((o) => o.confirmed));
  say(`all five confirmed after ${seconds(at)}`);
  for (const [index, claimer] of claimers.entries()) {
    expect((await claimer.wallet.balance()).confirmed).toBe(opened[index]?.amount);
  }

  at = Date.now();
  const back = await sender.envelopes.takeBack(sent.id);
  await back.confirmed;
  say(`took back ${back.amount} mojos, confirmed after ${seconds(at)}`);
  expect(opened.reduce((sum, o) => sum + o.amount, 0n) + back.amount).toBe(TOTAL);
  expect((await sender.envelopes.listSent())[0]).toMatchObject({
    status: 'taken_back',
    sharesOpened: 5,
  });
});
