// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import { pbkdf2Sync } from 'node:crypto';
import { TESTNET11 } from '@ge/chia';
import { createHandoffRequest } from '@ge/handoff';
import { accountFromSeed } from '@ge/wallet';
import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, stillMotion } from '../../test/render';
import { createWorld } from '../../test/world';
import { ConnectScreen } from './ConnectScreen';

// A real request from the app side, the way Klimper makes one: a one-time P-256 key pair and a
// nonce, both in the link's fragment.
async function klimperAsks() {
  const request = await createHandoffRequest('https://ge.test');
  return { search: new URL(request.url).hash, request };
}

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connect: handing the 24 words to Klimper (TASK-129)', () => {
  it('asks only on the button, then offers one link that only the asking app can read', async () => {
    const { search, request } = await klimperAsks();
    const services = createWorld().services;
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderScreen(<ConnectScreen search={search} />, { services });

    // What the page says before anything happens: Klimper will be able to spend everything.
    expect(await screen.findByText(/Klimper can spend all of it/)).toBeTruthy();
    expect(approve).not.toHaveBeenCalled(); // no prompt on load

    fireEvent.click(screen.getByRole('button', { name: 'Yes, bring it to Klimper' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy();
    expect(approve).toHaveBeenCalledExactlyOnceWith(search);

    // One link on clapandpay.com's return path, nothing to copy.
    const link = screen.getByRole('link', { name: 'Open Klimper' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('https://clapandpay.com/klimper/return#cp2.')).toBe(true);
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();

    // Only the app that asked can open it, and the words give the address the page knows.
    const payload = await request.open(href);
    expect(payload).toMatchObject({ v: 2, network: 'testnet11' });
    expect(payload.words.split(' ')).toHaveLength(24);
    const seed = pbkdf2Sync(payload.words, 'mnemonic', 2048, 64, 'sha512');
    expect(accountFromSeed(new Uint8Array(seed), TESTNET11).address).toBe(payload.address);
    expect((await services.wallet.current())?.address).toBe(payload.address);

    const other = await createHandoffRequest('https://ge.test');
    await expect(other.open(href)).rejects.toMatchObject({ code: 'wrong_receiver' });
  });

  it('refuses a link that did not come from the app, before asking for anything', async () => {
    const services = createWorld().services;
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    renderScreen(<ConnectScreen search="#v=2&k=short&n=x" />, { services });
    expect(
      await screen.findByRole('heading', { name: 'This did not come from Klimper' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(approve).not.toHaveBeenCalled();
  });

  it('says so when this device has no wallet and no passkey', async () => {
    const { search } = await klimperAsks();
    renderScreen(<ConnectScreen search={search} />, {
      services: createWorld({ keyStore: { noPasskey: true } }).services,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, bring it to Klimper' }));
    expect(await screen.findByRole('heading', { name: 'No money on this device' })).toBeTruthy();
  });

  it('says so for a wallet from before recovery words', async () => {
    const { search } = await klimperAsks();
    renderScreen(<ConnectScreen search={search} />, {
      services: createWorld({ keyStore: { version: 1, exists: true } }).services,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, bring it to Klimper' }));
    expect(
      await screen.findByRole('heading', { name: 'This money is from before recovery words' }),
    ).toBeTruthy();
  });

  it('a dismissed prompt changes nothing and can be tried again', async () => {
    const { search } = await klimperAsks();
    renderScreen(<ConnectScreen search={search} />, {
      services: createWorld({ keyStore: { cancelFirst: true } }).services,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, bring it to Klimper' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, bring it to Klimper' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy();
  });

  it('speaks German', async () => {
    const { search } = await klimperAsks();
    renderScreen(<ConnectScreen search={search} />, {
      lang: 'de',
      services: createWorld().services,
    });
    expect(await screen.findByRole('heading', { name: 'Dein Geld in Klimper' })).toBeTruthy();
  });
});
