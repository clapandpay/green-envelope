// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
//
// These run against the real services over a chain in memory. The envelope below is a real one:
// 1.48 XCH in five equal shares, so a share is 0.296 XCH, which is €7.40 at the €25 the price
// route serves. Nothing here is a stand-in pretending to be an envelope.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, stillMotion } from '../../test/render';
import { createWorld, type WorldOptions } from '../../test/world';
import { ClaimScreen } from './ClaimScreen';

const TOTAL = 1_480_000_000_000n; // five shares of 0.296 XCH
const SHARES = 5;

beforeEach(() => {
  stillMotion();
  history.replaceState(null, '', '/g/demo1234');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const envelopeState = (container: Element) =>
  container.querySelector('svg.env')?.getAttribute('class');

/** A real envelope on a real (in-memory) chain, and the levers to change what happened to it. */
async function anEnvelope(
  options: WorldOptions = {},
  from = 'Anna',
  message = 'Happy birthday! 🎂',
) {
  const world = createWorld(options);
  const sent = await world.makeEnvelope({
    total: TOTAL,
    shares: SHARES,
    mode: 'equal',
    from,
    message,
  });
  return { ...world, link: sent.link, sent };
}

/** Other people open `count` shares of it, each from their own wallet. */
async function othersOpen(
  world: Awaited<ReturnType<typeof anEnvelope>>,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const other = createWorld({ shared: world.fake, seedName: `claimer${i}` });
    await other.services.envelopes.open(world.link);
    world.fake.farmBlock();
  }
}

describe('claim: happy path', () => {
  it('shows the sealed envelope, opens it, shows the amount at once and confirms quietly', async () => {
    const world = await anEnvelope();
    const ensure = vi.spyOn(world.services.wallet, 'ensure');
    const { container } = renderScreen(<ClaimScreen link={world.link} />, {
      services: world.services,
    });

    // Act 1: nothing but the envelope. It cannot be tapped before we know it is there.
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
    expect(envelopeState(container)).toContain('env--sealed');
    expect(screen.queryByText(/Anna/)).toBeNull();
    expect(screen.queryByText('Happy birthday! 🎂')).toBeNull();
    expect(container.querySelector('.claim--told')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    // The amount is there as soon as open() resolves, still "on its way".
    expect(await screen.findByText('€7.40')).toBeTruthy();
    expect(ensure).toHaveBeenCalledOnce();
    // Act 3: now, and only now, the envelope says who it is from and what it says.
    expect(screen.getByRole('heading', { name: 'from Anna' })).toBeTruthy();
    expect(screen.getByText('Happy birthday! 🎂')).toBeTruthy();
    expect(container.querySelector('.claim--fresh .bars')).toBeTruthy();
    expect(screen.getByText(/0\.296\sXCH/)).toBeTruthy();
    expect(screen.getByText(/On its way/)).toBeTruthy();
    expect(screen.queryByText('Arrived. It is yours.')).toBeNull();
    expect(envelopeState(container)).toContain('env--open');
    expect(container.querySelector('output[aria-live="polite"]')?.textContent).toBe(
      'You got €7.40',
    );

    expect(screen.getByRole('button', { name: 'Send it on' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    const play = screen.getByRole('button', { name: /Play/ });
    expect(play.hasAttribute('disabled')).toBe(true);
    expect(play.textContent).toContain('coming soon');

    // It says "arrived" when the coin really is on the chain, not on a timer.
    world.fake.farmBlock();
    expect(await screen.findByText('Arrived. It is yours.')).toBeTruthy();
    expect(screen.queryByText(/On its way/)).toBeNull();
  });

  it('"Send it on" goes to a new envelope with the amount, "Keep it" to the wallet', async () => {
    const world = await anEnvelope();
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send it on' }));
    expect(location.pathname + location.search).toBe('/new?amount=296000000000');
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(location.pathname).toBe('/');
  });

  it('speaks German', async () => {
    const world = await anEnvelope();
    renderScreen(<ClaimScreen link={world.link} />, { lang: 'de', services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Öffnen' }));
    expect(await screen.findByText(/^7,40\s€$/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'von Anna' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weiterschenken' })).toBeTruthy();
  });

  it('shows XCH alone when there is no price', async () => {
    const world = await anEnvelope({ fetch: { eurPerXch: null } });
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText(/^0\.296\sXCH$/)).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('takes sender and message from the link', async () => {
    const world = await anEnvelope({}, 'Kai', 'Tor!');
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'from Kai' })).toBeTruthy();
    expect(screen.getByText('Tor!')).toBeTruthy();
  });
});

describe('claim: the other states', () => {
  it('empty: friendly, with a way to make your own', async () => {
    const world = await anEnvelope();
    await othersOpen(world, SHARES); // every share gone before this person arrives
    const { container } = renderScreen(<ClaimScreen link={world.link} />, {
      services: world.services,
    });
    expect(await screen.findByRole('heading', { name: 'All opened!' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(envelopeState(container)).toContain('env--empty');
    fireEvent.click(screen.getByRole('button', { name: 'Make your own' }));
    expect(location.pathname).toBe('/new');
  });

  it('taken back: reads as all opened, because the chain cannot say otherwise', async () => {
    const world = await anEnvelope();
    await world.services.envelopes.takeBack(world.sent.id);
    world.fake.farmBlock();
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });

    // What really happens today. A take-back spends the shares back to the sender, and a
    // spent share looks the same as an opened one to whoever follows the link, so the screen
    // says "All opened!".
    //
    // The nicer copy for this exists — `envelope_expired` maps to "This one went back" in the
    // claim reducer — but nothing in the real services ever throws it, so that branch cannot
    // be reached. Telling the two apart needs something the chain does not carry; until then
    // this test records the truth rather than the intention.
    expect(await screen.findByRole('heading', { name: 'All opened!' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make your own' })).toBeTruthy();
  });

  it('already opened: shows what they got, settled, without fanfare', async () => {
    const world = await anEnvelope();
    await world.services.envelopes.open(world.link); // this browser opened one earlier
    world.fake.farmBlock();
    const { container } = renderScreen(<ClaimScreen link={world.link} />, {
      services: world.services,
    });
    expect(
      await screen.findByRole('heading', { name: 'You opened this one already' }),
    ).toBeTruthy();
    expect(screen.getByText('€7.40')).toBeTruthy();
    expect(screen.getByText('Arrived. It is yours.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send it on' })).toBeTruthy();
    expect(container.querySelector('.confetti')).toBeNull();
    expect(container.querySelector('output[aria-live="polite"]')?.textContent).toBe('');
  });

  it('offline: says so and recovers on retry', async () => {
    const world = await anEnvelope();
    world.goOffline(1); // one call fails, the next works
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    expect(await screen.findByRole('heading', { name: 'No connection' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The envelope is safe');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('offline for good: retry stays available', async () => {
    const world = await anEnvelope();
    world.goOffline();
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'No connection' })).toBeTruthy(),
    );
  });

  it('bad link: no retry, a way home', async () => {
    const { container } = renderScreen(<ClaimScreen link="https://ge.test/g/x" />);
    expect(await screen.findByRole('heading', { name: 'This link is broken' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(envelopeState(container)).toContain('env--ghost');
  });

  it('a dismissed passkey prompt leaves the envelope sealed, and the second tap works', async () => {
    // The envelope is made first, then the keystore starts refusing, so the dismissal lands
    // on the claim rather than on making it.
    const world = await anEnvelope();
    const unlock = vi.spyOn(world.services.wallet, 'ensure');
    unlock.mockRejectedValueOnce(
      new (await import('../../services/types')).ServiceError('wallet_cancelled'),
    );
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No problem');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('€7.40')).toBeTruthy();
  });

  it('when the passkey fails, offers a new passkey (never a browser-only wallet) and opens into it', async () => {
    const world = await anEnvelope();
    const ensure = vi.spyOn(world.services.wallet, 'ensure');
    ensure.mockRejectedValueOnce(
      new (await import('../../services/types')).ServiceError('passkey_unavailable'),
    );
    const makeNew = vi.spyOn(world.services.wallet, 'makeNew');
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Safari or Chrome');
    expect(screen.queryByRole('button', { name: /browser only/i })).toBeNull();
    expect(makeNew).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /create a new passkey/i }));
    expect(await screen.findByText('€7.40')).toBeTruthy();
    expect(makeNew).toHaveBeenCalledTimes(1);
    expect((await world.services.wallet.current())?.kind).toBe('passkey');
  });

  it('losing the race for the last share ends in the friendly empty state', async () => {
    const world = await anEnvelope();
    vi.spyOn(world.services.envelopes, 'open').mockRejectedValue(
      new (await import('../../services/types')).ServiceError('envelope_empty'),
    );
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'All opened!' })).toBeTruthy();
  });

  it('"already opened" at open time looks again and shows the amount', async () => {
    const world = await anEnvelope();
    const { ServiceError } = await import('../../services/types');
    vi.spyOn(world.services.envelopes, 'open').mockRejectedValue(
      new ServiceError('already_opened'),
    );
    const inspect = vi.spyOn(world.services.envelopes, 'inspect');
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
  });
});

describe('claim: the Klimper backup (TASK-131)', () => {
  it('says plainly, under the amount, that the money needs a Klimper backup', async () => {
    const world = await anEnvelope();
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('€7.40')).toBeTruthy();
    expect(await screen.findByText(/Back it up in Klimper/)).toBeTruthy();
  });

  it('does not say it once the wallet is backed up', async () => {
    const world = await anEnvelope();
    // The sender's wallet opens the envelope here; it was handed to Klimper before.
    world.services.wallet.markBackedUp();
    renderScreen(<ClaimScreen link={world.link} />, { services: world.services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('€7.40')).toBeTruthy();
    expect(screen.queryByText(/Back it up in Klimper/)).toBeNull();
  });
});
