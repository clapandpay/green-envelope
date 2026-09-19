// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fastMock, renderScreen, stillMotion } from '../../test/render';
import { ClaimScreen } from './ClaimScreen';

const LINK = 'https://ge.test/g/demo1234#c2VjcmV0';

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

describe('claim: happy path', () => {
  it('shows the sealed envelope, opens it, shows the amount at once and confirms quietly', async () => {
    const services = fastMock([], 150);
    const ensure = vi.spyOn(services.wallet, 'ensure');
    const { container } = renderScreen(<ClaimScreen link={LINK} />, { services });

    expect(container.querySelector('.skeleton')).toBeTruthy(); // loading
    expect(await screen.findByRole('heading', { name: 'from Anna' })).toBeTruthy();
    expect(screen.getByText('Happy birthday! 🎂')).toBeTruthy();
    expect(screen.getByText('3 of 5 left')).toBeTruthy();
    expect(envelopeState(container)).toContain('env--sealed');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Opening…')).toBeTruthy();
    expect(envelopeState(container)).toContain('env--opening');

    // The amount is there as soon as open() resolves, still "on its way".
    expect(await screen.findByText('€7.40')).toBeTruthy();
    expect(ensure).toHaveBeenCalledOnce();
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

    expect(await screen.findByText('Arrived. It is yours.')).toBeTruthy();
    expect(screen.queryByText(/On its way/)).toBeNull();
  });

  it('"Send it on" goes to a new envelope with the amount, "Keep it" to the wallet', async () => {
    renderScreen(<ClaimScreen link={LINK} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send it on' }));
    expect(location.pathname + location.search).toBe('/new?amount=296000000000');
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(location.pathname).toBe('/');
  });

  it('speaks German', async () => {
    renderScreen(<ClaimScreen link={LINK} />, { lang: 'de' });
    expect(await screen.findByRole('heading', { name: 'von Anna' })).toBeTruthy();
    expect(screen.getByText('noch 3 von 5 da')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(await screen.findByText(/^7,40\s€$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weiterschenken' })).toBeTruthy();
  });

  it('shows XCH alone when there is no price', async () => {
    renderScreen(<ClaimScreen link={LINK} />, { services: fastMock(['noprice']) });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText(/^0\.296\sXCH$/)).toBeTruthy();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it('takes sender and message from the link', async () => {
    renderScreen(<ClaimScreen link="https://ge.test/g/other123?from=Kai&m=Tor!#x" />);
    expect(await screen.findByRole('heading', { name: 'from Kai' })).toBeTruthy();
    expect(screen.getByText('Tor!')).toBeTruthy();
  });
});

describe('claim: the other states', () => {
  it('empty: friendly, with a way to make your own', async () => {
    const { container } = renderScreen(<ClaimScreen link={LINK} />, {
      services: fastMock(['empty']),
    });
    expect(await screen.findByRole('heading', { name: 'All opened!' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(envelopeState(container)).toContain('env--empty');
    fireEvent.click(screen.getByRole('button', { name: 'Make your own' }));
    expect(location.pathname).toBe('/new');
  });

  it('expired or taken back', async () => {
    renderScreen(<ClaimScreen link={LINK} />, { services: fastMock(['expired']) });
    expect(await screen.findByRole('heading', { name: 'This one went back' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make your own' })).toBeTruthy();
  });

  it('already opened: shows what they got, settled, without fanfare', async () => {
    const { container } = renderScreen(<ClaimScreen link={LINK} />, {
      services: fastMock(['already']),
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
    renderScreen(<ClaimScreen link={LINK} />, { services: fastMock(['flaky']) });
    expect(await screen.findByRole('heading', { name: 'No connection' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The envelope is safe');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('offline for good: retry stays available', async () => {
    renderScreen(<ClaimScreen link={LINK} />, { services: fastMock(['offline']) });
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
    renderScreen(<ClaimScreen link={LINK} />, { services: fastMock(['cancel']) });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No problem');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('€7.40')).toBeTruthy();
  });

  it('losing the race for the last share ends in the friendly empty state', async () => {
    const services = fastMock();
    vi.spyOn(services.envelopes, 'open').mockRejectedValue(
      new (await import('../../services/types')).ServiceError('envelope_empty'),
    );
    renderScreen(<ClaimScreen link={LINK} />, { services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { name: 'All opened!' })).toBeTruthy();
  });

  it('"already opened" at open time looks again and shows the amount', async () => {
    const services = fastMock();
    const { ServiceError } = await import('../../services/types');
    vi.spyOn(services.envelopes, 'open').mockRejectedValue(new ServiceError('already_opened'));
    const inspect = vi.spyOn(services.envelopes, 'inspect');
    renderScreen(<ClaimScreen link={LINK} />, { services });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
  });
});
