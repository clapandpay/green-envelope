// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom

import { createHandoffRequest } from '@ge/handoff';
import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, stillMotion } from '../../test/render';
import { createWorld } from '../../test/world';
import { ConnectScreen } from './ConnectScreen';

// A real request from the app side, the way Klimper makes one: a one-time P-256 key pair whose
// public half travels in the link. The old fixture was 87 letter Bs, which only a stand-in
// would have accepted.
async function klimperAsks() {
  const request = await createHandoffRequest('https://ge.test');
  return { search: new URL(request.url).hash, request };
}

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connect: handing the wallet to Klimper', () => {
  it('shows the check number, asks once, and gives back a line only the app can read', async () => {
    const { search, request } = await klimperAsks();
    const services = createWorld().services;
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderScreen(<ConnectScreen search={search} />, { services });

    // Both sides work the number out from the key in the link, independently, and a person
    // compares them by eye. So the screen has to show the app's own number.
    expect(request.checkCode).toMatch(/^\d{6}$/);
    const shown = `${request.checkCode.slice(0, 3)} ${request.checkCode.slice(3)}`;
    expect(await screen.findByText(shown)).toBeTruthy();
    expect(screen.getByText(/numbers match/)).toBeTruthy();
    expect(approve).not.toHaveBeenCalled(); // nothing happens before the person says yes

    fireEvent.click(screen.getByRole('button', { name: 'Yes, it is me' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy();
    expect(approve).toHaveBeenCalledExactlyOnceWith(search);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied. Now go back to Klimper.')).toBeTruthy();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toMatch(/^cp1\./);
    // And only the app that asked can read it: the same request opens it, with the answer code
    // this page shows next to the answer.
    const { payload, answerCode } = await request.open(copied);
    expect(payload.address.startsWith('txch1')).toBe(true);
    expect(screen.getByTestId('answer-code').textContent).toBe(
      `${answerCode.slice(0, 3)} ${answerCode.slice(3)}`,
    );
  });

  it('refuses a link that did not come from the app, before asking for anything', async () => {
    const services = createWorld().services;
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    renderScreen(<ConnectScreen search="?v=1&k=short" />, { services });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, it is me' }));
    expect(await screen.findByRole('heading', { name: 'No money on this device' })).toBeTruthy();
  });

  it('a dismissed prompt changes nothing and can be tried again', async () => {
    const { search } = await klimperAsks();
    renderScreen(<ConnectScreen search={search} />, {
      services: createWorld({ keyStore: { cancelFirst: true } }).services,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, it is me' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it is me' }));
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
