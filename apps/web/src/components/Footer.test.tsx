// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { cleanup, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen } from '../test/render';
import { Footer, switchNetworkUrl } from './Footer';

afterEach(cleanup);

describe('the network toggle', () => {
  it('offers mainnet and testnet, with the one in use pressed', async () => {
    renderScreen(<Footer />);
    const main = await screen.findByRole('button', { name: 'Mainnet' });
    const test = screen.getByRole('button', { name: 'Testnet' });
    expect([main, test].filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('keeps the page and its other parameters, and leaves an envelope for the wallet', () => {
    expect(switchNetworkUrl({ pathname: '/hello', search: '?x=1' }, 'testnet11')).toBe(
      '/hello?x=1&net=testnet',
    );
    expect(switchNetworkUrl({ pathname: '/', search: '?net=testnet' }, 'mainnet')).toBe(
      '/?net=main',
    );
    // A claim link is for the chain it was made on: from there the switch opens the wallet.
    expect(switchNetworkUrl({ pathname: '/g/abc', search: '?n=2' }, 'mainnet')).toBe(
      '/?n=2&net=main',
    );
  });
});
