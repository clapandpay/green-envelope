// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { networkFromSearch, resolveNetwork, withNetwork } from './network';

describe('networkFromSearch', () => {
  it('reads the names a tester would type', () => {
    expect(networkFromSearch('?net=testnet')).toBe('testnet11');
    expect(networkFromSearch('?net=test')).toBe('testnet11');
    expect(networkFromSearch('?net=testnet11')).toBe('testnet11');
    expect(networkFromSearch('?net=main')).toBe('mainnet');
    expect(networkFromSearch('?net=mainnet')).toBe('mainnet');
  });

  it('ignores case and surrounding space', () => {
    expect(networkFromSearch('?net=%20TestNet%20')).toBe('testnet11');
  });

  it('is null when nothing is asked for, or when it makes no sense', () => {
    expect(networkFromSearch('')).toBeNull();
    expect(networkFromSearch('?mock=1')).toBeNull();
    expect(networkFromSearch('?net=')).toBeNull();
    expect(networkFromSearch('?net=moonnet')).toBeNull();
  });
});

describe('resolveNetwork', () => {
  it('is mainnet when nothing says otherwise', () => {
    expect(resolveNetwork('', undefined)).toBe('mainnet');
    expect(resolveNetwork('?mock=1', undefined)).toBe('mainnet');
    // An unknown build value must never silently land a person on a test chain.
    expect(resolveNetwork('', 'nonsense')).toBe('mainnet');
  });

  it('takes the build value when the link says nothing', () => {
    expect(resolveNetwork('', 'testnet11')).toBe('testnet11');
    expect(resolveNetwork('', 'mainnet')).toBe('mainnet');
  });

  it('lets the link win over the build', () => {
    expect(resolveNetwork('?net=testnet', 'mainnet')).toBe('testnet11');
    expect(resolveNetwork('?net=main', 'testnet11')).toBe('mainnet');
  });
});

describe('withNetwork', () => {
  const LINK = 'https://clapandpay.com/g/abc?n=5&from=Anna#s3cr3t';

  it('leaves a mainnet link exactly as it was', () => {
    expect(withNetwork(LINK, 'mainnet')).toBe(LINK);
  });

  it('marks a test-chain link so it opens on the chain it was made on', () => {
    const marked = withNetwork(LINK, 'testnet11');
    expect(new URL(marked).searchParams.get('net')).toBe('testnet');
    // Round trip: what the marked link says is what the app will resolve.
    expect(resolveNetwork(new URL(marked).search, undefined)).toBe('testnet11');
  });

  it('keeps the secret in the fragment untouched', () => {
    // The secret is the money. A query parameter must never disturb it.
    const marked = new URL(withNetwork(LINK, 'testnet11'));
    expect(marked.hash).toBe('#s3cr3t');
    expect(marked.pathname).toBe('/g/abc');
    expect(marked.searchParams.get('n')).toBe('5');
    expect(marked.searchParams.get('from')).toBe('Anna');
  });
});
