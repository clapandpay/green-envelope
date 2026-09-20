// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletInfo } from '../../services/types';
import { fastMock, renderScreen, stillMotion } from '../../test/render';
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
    const services = fastMock();
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
    const services = fastMock();
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
    renderScreen(<WalletScreen />, { services: fastMock(['cancel']) });

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
    renderScreen(<WalletScreen />, { services: fastMock(['nopasskey']) });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    const make = await screen.findByRole('button', { name: /start fresh/i });
    expect(screen.getByRole('button', { name: /already have money here/i })).toBeTruthy();

    fireEvent.click(make);
    expect(await screen.findByText('Your money')).toBeTruthy();
  });

  it('never makes a wallet on its own when the prompt is only dismissed', async () => {
    const services = fastMock(['cancel']);
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
