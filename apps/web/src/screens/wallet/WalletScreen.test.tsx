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
    // The envelope to try again, and a new passkey in case this one does not work.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /create a new passkey/i })).toBeTruthy();
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

  it('is told, and offered a new passkey but never a browser-only wallet, without PRF', async () => {
    const services = createWorld({ keyStore: { noPrf: true, noPasskey: true } }).services;
    const makeNew = vi.spyOn(services.wallet, 'makeNew');
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    expect(await screen.findByText(/open the link in safari or chrome/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /browser only/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /create a new passkey/i }));
    await waitFor(() => expect(makeNew).toHaveBeenCalledTimes(1));
    // Still no PRF: still told, and still no wallet.
    expect(await screen.findByText(/open the link in safari or chrome/i)).toBeTruthy();
    expect(await services.wallet.current()).toBeNull();
  });

  it('offers a new passkey when the passkey prompt fails, and opens into it', async () => {
    const services = createWorld().services;
    vi.spyOn(services.wallet, 'ensure').mockRejectedValueOnce(
      new (await import('../../services/types')).ServiceError('wallet_cancelled'),
    );
    renderScreen(<WalletScreen />, { services });

    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    fireEvent.click(await screen.findByRole('button', { name: /create a new passkey/i }));
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect((await services.wallet.current())?.kind).toBe('passkey');
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

describe('money from the old wallet', () => {
  it('shows it and moves it here with one tap', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    world.fundLegacy(2_000_000_000_000n);
    await world.services.wallet.current();
    await world.services.wallet.ensure();
    const move = vi.spyOn(world.services.wallet, 'moveEarlier');
    renderScreen(<WalletScreen />, { services: world.services });

    expect(await screen.findByText('Money from before')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move it here' }));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/on its way/i)).toBeTruthy();
  });

  it('shows nothing when the old wallet is empty', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    await world.services.wallet.current();
    await world.services.wallet.ensure();
    renderScreen(<WalletScreen />, { services: world.services });
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByText('Money from before')).toBeNull();
  });
});

describe('your envelopes', () => {
  it('no longer shows one that was taken back', async () => {
    const world = createWorld();
    const kept = await world.makeEnvelope({ total: 2_000_000_000n, shares: 2, from: 'kept' });
    const back = await world.makeEnvelope({ total: 3_000_000_000n, shares: 2, from: 'back' });
    await world.services.envelopes.takeBack(back.id);
    world.fake.farmBlock();
    renderScreen(<WalletScreen />, { services: world.services });
    await screen.findByText('Your envelopes');
    const ids = (await world.services.envelopes.listSent()).map((e) => [e.id, e.status]);
    expect(ids).toContainEqual([back.id, 'taken_back']);
    await waitFor(() => expect(screen.queryAllByRole('listitem').length).toBe(1));
    expect(kept.id).not.toBe(back.id);
  });
});

describe('moving to Klimper', () => {
  it('is offered once there is money, and sends everything to the pasted address', async () => {
    const world = createWorld();
    await world.fund(3_000_000_000n);
    world.fake.farmBlock();
    const move = vi.spyOn(world.services.wallet, 'moveToKlimper');
    renderScreen(<WalletScreen />, { services: world.services });

    fireEvent.click(await screen.findByRole('button', { name: 'Move to Klimper' }));
    const sheet = await screen.findByRole('dialog');
    const field = within(sheet).getByLabelText(/your klimper address/i);
    fireEvent.input(field, { target: { value: 'not an address' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    expect(await within(sheet).findByText(/copy it from klimper/i)).toBeTruthy();

    const other = createWorld({ shared: world.fake });
    const { address } = await other.services.wallet.ensure();
    fireEvent.input(field, { target: { value: address } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }));
    // One look at the whole address before anything moves.
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText(address)).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: /yes, move it/i }));
    await waitFor(() => expect(move).toHaveBeenCalledWith(address));
    expect(await screen.findByText(/on its way to klimper/i)).toBeTruthy();
  });

  it('the wallet says where its passkey belongs, small amounts only, and what comes later', async () => {
    const services = createWorld().services;
    renderScreen(<WalletScreen />, { services });
    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    // Up front: one short line. The whole story: one tap on (i).
    expect(await screen.findByText(/small amounts only/i)).toBeTruthy();
    expect(screen.queryByText(/your passkey belongs to/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /about this money/i }));
    const about = await screen.findByRole('dialog');
    expect(within(about).getByText(/your passkey belongs to/i)).toBeTruthy();
    expect(within(about).getByText(/more passkeys or chia signer/i)).toBeTruthy();
    expect(within(about).getByText(/24 recovery words/i)).toBeTruthy();
  });

  it('is not shown on an empty wallet, and the wallet keeps working', async () => {
    const services = createWorld().services;
    renderScreen(<WalletScreen />, { services });
    fireEvent.click(await screen.findByRole('button', { name: /tap the envelope/i }));
    expect(await screen.findByText('Your money')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move to Klimper' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
});
