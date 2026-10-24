// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { encodeLink } from '@ge/envelope';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FaucetConfig, PREF_FAUCET } from '../../lib/faucet';
import { renderScreen, stillMotion } from '../../test/render';
import { HelloScreen } from './HelloScreen';

const faucet: FaucetConfig = { url: 'https://f.test/api', origins: [location.origin] };
const link = encodeLink(location.origin, {
  publicKey: new Uint8Array(48).fill(3),
  secret: new Uint8Array(16).fill(5),
  shares: 1,
});
const linkPath = (() => {
  const url = new URL(link);
  return `${url.pathname}${url.search}${url.hash}`;
})();
const answer = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => new Response(JSON.stringify(body), init)) as unknown as typeof fetch;
const getButton = () => screen.getByRole('button', { name: 'Get your envelope' });

beforeEach(() => {
  stillMotion();
  localStorage.clear();
  history.replaceState(null, '', '/hello');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('hello: the front door', () => {
  it('shows the hero, the one button, the steps, the honest line and the way to make your own', () => {
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({ status: 'empty' })} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Get your green envelope');
    expect(document.querySelector('svg.env--sealed')).not.toBeNull();
    expect(getButton()).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/real money on a public network/)).toBeTruthy();
    const own = screen.getByRole('link', { name: 'Make your own envelope' });
    expect(own.getAttribute('href')).toBe('/new');
  });

  it('is in German too', () => {
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({ status: 'empty' })} />, {
      lang: 'de',
    });
    expect(screen.getByRole('button', { name: 'Umschlag holen' })).toBeTruthy();
  });

  it('gets a link and walks into the claim route, the secret in the fragment', async () => {
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({ link })} />);
    fireEvent.click(getButton());
    await waitFor(() => expect(location.pathname).toMatch(/^\/g\//));
    expect(location.hash.length).toBeGreaterThan(10);
    expect(localStorage.getItem(PREF_FAUCET)).toBe(linkPath);
  });

  it('is double-click safe: one request, however hard you tap', async () => {
    const fetcher = answer({ link });
    renderScreen(<HelloScreen faucet={faucet} fetcher={fetcher} />);
    const button = getButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(location.pathname).toMatch(/^\/g\//));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('survives the back button: the envelope is remembered, not requested twice', () => {
    localStorage.setItem(PREF_FAUCET, linkPath);
    const fetcher = answer({ link });
    renderScreen(<HelloScreen faucet={faucet} fetcher={fetcher} />);
    expect(screen.getByText('You already have one')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Get your envelope' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to my money' }));
    expect(location.pathname).toBe('/');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('can open the envelope it already has', () => {
    localStorage.setItem(PREF_FAUCET, linkPath);
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({})} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open my envelope' }));
    expect(location.pathname).toBe(new URL(link).pathname);
  });

  it('ignores a damaged or hostile memory', () => {
    localStorage.setItem(PREF_FAUCET, 'javascript:alert(1)');
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({})} />);
    expect(getButton()).toBeTruthy();
  });

  it('works when storage refuses everything', async () => {
    const refuse = () => {
      throw new Error('no');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({ link })} />);
    fireEvent.click(getButton());
    await waitFor(() => expect(location.pathname).toMatch(/^\/g\//));
  });

  it('says the faucet is dry, keeps the hero, and offers to make one', async () => {
    renderScreen(<HelloScreen faucet={faucet} fetcher={answer({ status: 'empty' })} />);
    fireEvent.click(getButton());
    expect(await screen.findByText('All envelopes are in flight')).toBeTruthy();
    expect(document.querySelector('svg.env--empty')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Make your own envelope' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(location.pathname).toBe('/hello');
  });

  it('counts down when rate limited, then lets you try again', async () => {
    const fetcher = answer('', { status: 429, headers: { 'retry-after': '2' } });
    renderScreen(<HelloScreen faucet={faucet} fetcher={fetcher} />);
    fireEvent.click(getButton());
    expect(await screen.findByText('Lots of people are tapping')).toBeTruthy();
    const wait = screen.getByRole('button', { name: /Try again in \d s/ });
    expect((wait as HTMLButtonElement).disabled).toBe(true);
    expect(
      await screen.findByRole('button', { name: 'Get your envelope' }, { timeout: 4000 }),
    ).toBeTruthy();
  });

  it('keeps the hero and offers a retry when offline', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    renderScreen(<HelloScreen faucet={faucet} fetcher={fetcher as unknown as typeof fetch} />);
    fireEvent.click(getButton());
    expect(await screen.findByText('No connection')).toBeTruthy();
    expect(document.querySelector('svg.env--ghost')).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2); // one retry
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('does not follow a hostile link', async () => {
    const evil = answer({ link: 'https://evil.test/g/AAAA#BBBB' });
    renderScreen(<HelloScreen faucet={faucet} fetcher={evil} />);
    fireEvent.click(getButton());
    expect(await screen.findByText('That did not work')).toBeTruthy();
    expect(location.pathname).toBe('/hello');
    expect(localStorage.getItem(PREF_FAUCET)).toBeNull();
  });

  it('treats a filled honeypot as a dry faucet and never asks', async () => {
    const fetcher = answer({ link });
    renderScreen(<HelloScreen faucet={faucet} fetcher={fetcher} />);
    const trap = document.querySelector<HTMLInputElement>('input[name="website"]');
    if (!trap) throw new Error('no honeypot');
    act(() => {
      trap.value = 'http://spam.test';
    });
    fireEvent.click(getButton());
    expect(await screen.findByText('All envelopes are in flight')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('hello: no faucet configured', () => {
  it('shows no demo: it goes straight to the app’s start, in place of /hello', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    history.pushState(null, '', '/hello');
    const before = history.length;
    renderScreen(<HelloScreen faucet={null} />);
    await waitFor(() => expect(location.pathname).toBe('/'));
    expect(history.length).toBe(before);
    expect(screen.queryByText(/demo/i)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
