// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletInfo } from '../../services/types';
import { renderScreen, stillMotion } from '../../test/render';
import { createWorld } from '../../test/world';
import { WalletScreen } from './WalletScreen';

beforeEach(() => stillMotion());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('first run: the envelope and almost nothing else', () => {
  it('offers exactly one thing to do, and it is the envelope', async () => {
    renderScreen(<WalletScreen />);

    const open = await screen.findByRole('button', { name: /tap the envelope/i });
    expect(open).toBeTruthy();
    // Nothing else is competing for the tap: no second button, no link away.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    // The envelope is there, sealed and waiting.
    expect(document.querySelector('.env--sealed')).toBeTruthy();
    expect(screen.getByText('Tap to open')).toBeTruthy();
  });

  it('opens the envelope and the wallet in one tap', async () => {
    const services = createWorld().services;
    const open = vi.spyOn(services.wallet, 'open');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    // One tap, one call: it neither asks twice nor asks something else first.
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));

    // And it lands on the money, which is what the screen is for.
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.getByRole('link', { name: /new envelope/i })).toBeTruthy();
  });

  it('shows the envelope opening rather than a spinner while the phone asks', async () => {
    const services = createWorld().services;
    // Hold the passkey answer so the in-between state can be observed.
    let release: (value: WalletInfo) => void = () => {};
    vi.spyOn(services.wallet, 'open').mockReturnValue(
      new Promise<WalletInfo>((resolve) => {
        release = resolve;
      }),
    );
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    await waitFor(() => expect(document.querySelector('.env--opening')).toBeTruthy());
    expect(screen.getByText('Getting ready…')).toBeTruthy();
    release({ kind: 'passkey', address: 'txch1demo' });
  });

  it('stays on the envelope and says so when the prompt is dismissed', async () => {
    // `cancel` makes the first prompt fail, the way a dismissed Face ID sheet does.
    renderScreen(<WalletScreen />, {
      services: createWorld({ keyStore: { cancelFirst: true } }).services,
    });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    expect(await screen.findByText(/tap again when you are ready/i)).toBeTruthy();
    // Still the first screen: no half-made wallet, and the envelope is sealed again.
    expect(screen.queryByText('Your money')).toBeNull();
    await waitFor(() => expect(document.querySelector('.env--sealed')).toBeTruthy());
  });
});

describe('a person who has never been here', () => {
  it('is offered a new wallet when there is no passkey to open', async () => {
    // `nopasskey` is a device with nothing on it. WebAuthn cannot tell that apart from a
    // dismissed prompt, so the screen stops guessing and asks instead of looping.
    renderScreen(<WalletScreen />, {
      services: createWorld({ keyStore: { noPasskey: true } }).services,
    });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    const make = await screen.findByRole('button', { name: /start fresh/i });
    expect(screen.getByRole('button', { name: /already have money here/i })).toBeTruthy();

    fireEvent.click(make);
    expect(await screen.findByText('Your money')).toBeTruthy();
  });

  it('never makes a wallet on its own when the prompt is only dismissed', async () => {
    const services = createWorld({ keyStore: { cancelFirst: true } }).services;
    const ensure = vi.spyOn(services.wallet, 'ensure');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    expect(await screen.findByText(/tap again when you are ready/i)).toBeTruthy();

    // The dangerous guess: a returning person whose money is in the wallet the passkey opens
    // must never be handed a second, empty one because they hesitated.
    expect(ensure).not.toHaveBeenCalled();
    expect(screen.queryByText('Your money')).toBeNull();
  });
});

describe('securing a browser-only wallet with a passkey', () => {
  it('offers it, saves it, and stops offering once it is done', async () => {
    // `device` is a wallet the browser holds on its own: the only case where this is offered.
    const services = createWorld({ keyStore: { kind: 'device' } }).services;
    const upgrade = vi.spyOn(services.wallet, 'upgradeToPasskey');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    const secure = await screen.findByRole('button', { name: /secure now/i });
    // One line and one tap: no paragraph explaining what the phone is about to do anyway.
    expect(screen.queryByText(/lives only in this browser/i)).toBeNull();

    fireEvent.click(secure);
    await waitFor(() => expect(upgrade).toHaveBeenCalledTimes(1));

    // Accepted in the password manager, so it is done, and the offer is gone for good.
    await waitFor(() => expect(screen.queryByRole('button', { name: /secure now/i })).toBeNull());
    expect(await screen.findByText(/your money is now protected/i)).toBeTruthy();
  });
});

describe('logging out', () => {
  async function intoWallet(options: Parameters<typeof createWorld>[0] = {}) {
    const { services } = createWorld(options);
    renderScreen(<WalletScreen />, { services });
    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    await screen.findByText('Your money');
    return services;
  }

  it('is there once there is money to log out of, and takes you back to the envelope', async () => {
    const services = await intoWallet();
    const forget = vi.spyOn(services.wallet, 'forget');

    fireEvent.click(screen.getByRole('button', { name: /^log out$/i }));
    // A passkey wallet comes back, so this is a door, not a cliff.
    expect(await screen.findByText(/come back any time/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /yes, log out/i }));
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(1));
    // Back to the first screen, which is the envelope.
    expect(await screen.findByRole('button', { name: /tap the envelope/i })).toBeTruthy();
  });

  it('says the money is lost when the browser is the only place it lives', async () => {
    // A device wallet has no passkey behind it: forgetting it is forgetting the money.
    await intoWallet({ keyStore: { kind: 'device' } });

    fireEvent.click(screen.getByRole('button', { name: /^log out$/i }));

    expect(await screen.findByText(/gone for good/i)).toBeTruthy();
    expect(screen.queryByText(/come back any time/i)).toBeNull();
    // And the safer way out is offered inside the sheet, before the way that loses it.
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /secure now/i })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: /yes, log out/i })).toBeTruthy();
  });
});
