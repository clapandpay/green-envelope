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
    const ensure = vi.spyOn(services.wallet, 'ensure');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    // One tap, one call: it neither asks twice nor asks something else first.
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));

    // And it lands on the money, which is what the screen is for.
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.getByRole('link', { name: /new envelope/i })).toBeTruthy();
  });

  it('shows the envelope opening rather than a spinner while the phone asks', async () => {
    const services = createWorld().services;
    // Hold the passkey answer so the in-between state can be observed.
    let release: (value: WalletInfo) => void = () => {};
    vi.spyOn(services.wallet, 'ensure').mockReturnValue(
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

  it('stays on the envelope and says so when every prompt is dismissed', async () => {
    renderScreen(<WalletScreen />, {
      services: createWorld({ keyStore: { cancelAll: true } }).services,
    });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    expect(await screen.findByText(/tap again when you are ready/i)).toBeTruthy();
    // Still the first screen: no half-made wallet, and the envelope is sealed again.
    expect(screen.queryByText('Your money')).toBeNull();
    await waitFor(() => expect(document.querySelector('.env--sealed')).toBeTruthy());
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('a person who has never been here', () => {
  it('gets a wallet from the same one tap when the phone has no passkey', async () => {
    // Sign-in finds nothing, so the phone's create sheet comes next: still one tap here.
    const services = createWorld({ keyStore: { noPasskey: true } }).services;
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    expect(await screen.findByText('Your money')).toBeTruthy();
  });

  it('is told, and offered a browser-only wallet, when this browser has no PRF', async () => {
    const services = createWorld({ keyStore: { noPrf: true, noPasskey: true } }).services;
    const keepInBrowser = vi.spyOn(services.wallet, 'keepInBrowser');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    expect(await screen.findByText(/open the link in safari or chrome/i)).toBeTruthy();
    // Never made on its own: it waits for this button.
    expect(keepInBrowser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep it in this browser only/i }));
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(keepInBrowser).toHaveBeenCalledTimes(1);
  });
});

describe('a second account', () => {
  it('is offered from a passkey wallet and asks before making one', async () => {
    const services = createWorld({ keyStore: { exists: true } }).services;
    await services.wallet.ensure();
    const makeNew = vi.spyOn(services.wallet, 'makeNew');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /open a second account/i }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/your money stays in this account/i)).toBeTruthy();
    expect(makeNew).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: /yes, open one/i }));
    await waitFor(() => expect(makeNew).toHaveBeenCalledTimes(1));
  });

  it('is not offered for an older passkey wallet, whose money sign-in would not find', async () => {
    const services = createWorld({ keyStore: { exists: true, version: 1 } }).services;
    await services.wallet.ensure();
    renderScreen(<WalletScreen />, { services });

    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open a second account/i })).toBeNull();
  });

  it('is not offered for a wallet that lives only in this browser', async () => {
    const services = createWorld({ keyStore: { kind: 'device', exists: true } }).services;
    await services.wallet.ensure();
    renderScreen(<WalletScreen />, { services });

    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open a second account/i })).toBeNull();
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
    // One line and one tap: no paragraph explaining what the phone is about to do anyway. The
    // one place that says where the money lives is the backup card (TASK-131).
    expect(screen.getAllByText(/lives only in this browser/i)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Back it up in Klimper' })).toBeTruthy();

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

describe('the wait while the wallet comes up', () => {
  it('shows the wallet before the chain has answered, with the amount still to come', async () => {
    const { services } = createWorld();
    // A chain that takes its time about the balance, which is what a phone on a train is.
    let release: (value: { confirmed: bigint; pending: bigint }) => void = () => {};
    vi.spyOn(services.wallet, 'balance').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { container } = renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    // The screen is there while the number is not: everything it needs to exist is local.
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.getByRole('link', { name: /new envelope/i })).toBeTruthy();
    expect(container.querySelector('.amount .skeleton')).toBeTruthy();

    release({ confirmed: 7_000_000_000n, pending: 0n });

    // And the number lands in the shape that was already waiting for it.
    await waitFor(() => expect(container.querySelector('.amount .skeleton')).toBeNull());
  });

  it('does not let a failing sent list keep the balance off the screen', async () => {
    const { services } = createWorld();
    vi.spyOn(services.envelopes, 'listSent').mockRejectedValue(new Error('chain is unwell'));
    const { container } = renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    expect(await screen.findByText('Your money')).toBeTruthy();
    // The two slow answers are fetched separately and fail separately.
    await waitFor(() => expect(container.querySelector('.amount .skeleton')).toBeNull());
  });
});

describe('the ceremony', () => {
  /** Lets the real timings run, instead of the stillness the other tests ask for. */
  function withMotion() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
  }

  it('is over only once the wallet behind it is loaded', async () => {
    withMotion();
    const { services } = createWorld();
    // A chain that answers in a fifth of a second, which is an ordinary one.
    const real = services.wallet.balance.bind(services.wallet);
    vi.spyOn(services.wallet, 'balance').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(real()), 200)),
    );
    const { container } = renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    // The envelope is still opening while the chain is being asked.
    await waitFor(() => expect(container.querySelector('.env--open')).toBeTruthy());

    // And when it finally gives up the screen, the amount is there rather than a skeleton:
    // the ceremony is long enough to have covered the asking.
    const money = await screen.findByText('Your money', undefined, { timeout: 4000 });
    expect(money).toBeTruthy();
    expect(container.querySelector('.amount .skeleton')).toBeNull();
  });
});

describe('money from before 24 words (TASK-128)', () => {
  it('shows it and moves it here with one tap', async () => {
    const world = createWorld({ keyStore: { exists: true, earlier: 'anna' } });
    world.fundEarlier(2_000_000_000_000n);
    await world.services.wallet.ensure();
    const move = vi.spyOn(world.services.wallet, 'moveEarlier');
    renderScreen(<WalletScreen />, { services: world.services });

    expect(await screen.findByText('Money from before')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move it here' }));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/on its way/i)).toBeTruthy();
  });

  it('shows nothing when there is no money from before', async () => {
    const world = createWorld({ keyStore: { exists: true, earlier: 'anna' } });
    await world.services.wallet.ensure();
    renderScreen(<WalletScreen />, { services: world.services });
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByText('Money from before')).toBeNull();
  });
});

describe('the Klimper backup (TASK-131)', () => {
  it('asks for it, with the download and the way in, and the wallet keeps working', async () => {
    const services = createWorld().services;
    renderScreen(<WalletScreen />, { services });
    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));

    expect(await screen.findByRole('heading', { name: 'Back it up in Klimper' })).toBeTruthy();
    expect(screen.getByText(/nobody can get it back/i)).toBeTruthy();
    expect(screen.getByText(/Use my Clap and Pay money/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get Klimper' }).getAttribute('href')).toBe(
      'https://clapandpay.com/klimper',
    );
    // Not in the way: sending and making envelopes are still there.
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /new envelope/i })).toBeTruthy();
  });

  it('stops once the wallet was handed to Klimper from this browser', async () => {
    const services = createWorld().services;
    await services.wallet.ensure();
    services.wallet.markBackedUp();
    renderScreen(<WalletScreen />, { services });
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Back it up in Klimper' })).toBeNull();
  });
});
