// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { misplacedLink, sitesFrom, switchNetworkUrl } from '../lib/network';
import { renderScreen } from '../test/render';
import { Footer } from './Footer';

afterEach(cleanup);

describe('the network toggle', () => {
  it('offers mainnet and testnet, with the one in use pressed', async () => {
    renderScreen(<Footer />);
    const main = await screen.findByRole('button', { name: 'Mainnet' });
    const test = screen.getByRole('button', { name: 'Testnet' });
    expect([main, test].filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('on the real sites moves to the other site, keeping the page and the fragment', () => {
    const sites = sitesFrom({});
    expect(
      switchNetworkUrl(
        { origin: 'https://envelope.clapandpay.com', pathname: '/hello', search: '?x=1' },
        'testnet11',
        sites,
      ),
    ).toBe('https://testnet.envelope.clapandpay.com/hello?x=1');
    expect(
      switchNetworkUrl(
        { origin: 'https://testnet.envelope.clapandpay.com', pathname: '/g/abc', search: '' },
        'mainnet',
        sites,
      ),
    ).toBe('https://envelope.clapandpay.com/');
    // An old testnet link on the mainnet site goes to the testnet site, secret and all.
    expect(
      misplacedLink(
        {
          origin: 'https://envelope.clapandpay.com',
          pathname: '/g/abc',
          search: '?n=2&net=testnet',
          hash: '#secret',
        },
        sites,
      ),
    ).toBe('https://testnet.envelope.clapandpay.com/g/abc?n=2#secret');
    expect(
      misplacedLink(
        { origin: 'https://envelope.clapandpay.com', pathname: '/', search: '', hash: '' },
        sites,
      ),
    ).toBeNull();
  });

  it('elsewhere (localhost) keeps one site and switches with ?net=', () => {
    const sites = sitesFrom({});
    const local = { origin: 'http://localhost:8787', pathname: '/hello', search: '?x=1' };
    expect(switchNetworkUrl(local, 'testnet11', sites)).toBe('/hello?x=1&net=testnet');
    expect(
      switchNetworkUrl({ ...local, pathname: '/g/abc', search: '?n=2' }, 'mainnet', sites),
    ).toBe('/?n=2&net=main');
    expect(misplacedLink({ ...local, search: '?net=main', hash: '' }, sites)).toBeNull();
  });
});
