// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastMock, renderScreen, stillMotion } from '../../test/render';
import { ConnectScreen } from './ConnectScreen';

const SEARCH = `?v=1&k=${'B'.repeat(87)}`;

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connect: handing the wallet to Klimper', () => {
  it('shows the check number, asks once, and gives back a line only the app can read', async () => {
    const services = fastMock([]);
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderScreen(<ConnectScreen search={SEARCH} />, { services });

    expect(await screen.findByText('481 516')).toBeTruthy();
    expect(screen.getByText(/numbers match/)).toBeTruthy();
    expect(approve).not.toHaveBeenCalled(); // nothing happens before the person says yes

    fireEvent.click(screen.getByRole('button', { name: 'Yes, with my face or finger' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy();
    expect(approve).toHaveBeenCalledExactlyOnceWith(SEARCH);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied. Now go back to Klimper.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^cp1\./));
  });

  it('refuses a link that did not come from the app, before asking for anything', async () => {
    const services = fastMock([]);
    const approve = vi.spyOn(services.wallet, 'connectApprove');
    renderScreen(<ConnectScreen search="?v=1&k=short" />, { services });
    expect(
      await screen.findByRole('heading', { name: 'This did not come from Klimper' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(approve).not.toHaveBeenCalled();
  });

  it('says so when this device has no wallet and no passkey', async () => {
    renderScreen(<ConnectScreen search={SEARCH} />, { services: fastMock(['nopasskey']) });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, with my face or finger' }));
    expect(await screen.findByRole('heading', { name: 'No money on this device' })).toBeTruthy();
  });

  it('a dismissed prompt changes nothing and can be tried again', async () => {
    renderScreen(<ConnectScreen search={SEARCH} />, { services: fastMock(['cancel']) });
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, with my face or finger' }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, with my face or finger' }));
    expect(await screen.findByRole('heading', { name: 'Ready' })).toBeTruthy();
  });

  it('speaks German', async () => {
    renderScreen(<ConnectScreen search={SEARCH} />, { lang: 'de' });
    expect(await screen.findByRole('heading', { name: 'Dein Geld in Klimper' })).toBeTruthy();
  });
});
