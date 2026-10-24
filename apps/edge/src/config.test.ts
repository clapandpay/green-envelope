// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parsePublicKey, toHex0x } from './bytes';
import { configFromEnv } from './config';
import { contentSecurityPolicy } from './security';

describe('configFromEnv', () => {
  it('defaults to mainnet and its public endpoint', () => {
    const config = configFromEnv({});
    expect(config.network).toBe('mainnet');
    expect(config.chainEndpoints).toEqual(['https://api.coinset.org']);
    expect(config.publicOrigin).toBeNull();
    expect(config.shareLookupBudgetMs).toBe(1500);
  });

  it('reads and normalises the environment', () => {
    const config = configFromEnv({
      NETWORK: 'testnet11',
      CHAIN_ENDPOINTS: ' https://a.test/ , https://b.test/rpc//,ftp://c.test, nonsense ,',
      PUBLIC_ORIGIN: 'https://clapandpay.com/some/path',
    });
    expect(config.network).toBe('testnet11');
    // The configured nodes, then the network's public node as the last resort.
    expect(config.chainEndpoints).toEqual([
      'https://a.test',
      'https://b.test/rpc',
      'https://testnet11.api.coinset.org',
    ]);
    expect(config.publicOrigin).toBe('https://clapandpay.com');
    expect(config.chainApiKey).toBeNull();
  });

  it('reads the browser’s node and its public key at runtime', () => {
    const config = configFromEnv({
      PUBLIC_CHAIN_ENDPOINTS: 'https://api.nodexch.com/',
      PUBLIC_CHAIN_API_KEY: 'pk_public',
    });
    expect(config.browserChain).toEqual({
      endpoints: ['https://api.nodexch.com'],
      apiKey: 'pk_public',
    });
    expect(configFromEnv({}).browserChain).toBeNull();
  });

  it('takes a node key from the environment, for the first configured node only', () => {
    const config = configFromEnv({
      CHAIN_ENDPOINTS: 'https://api.nodexch.com',
      CHAIN_API_KEY: ' secret ',
    });
    expect(config.chainEndpoints).toEqual(['https://api.nodexch.com', 'https://api.coinset.org']);
    expect(config.chainApiKey).toBe('secret');
    // Without a configured node there is nobody to give a key to.
    expect(configFromEnv({ CHAIN_API_KEY: 'secret' }).chainApiKey).toBeNull();
  });

  it('falls back to the network default when no endpoint is usable', () => {
    const config = configFromEnv({ NETWORK: 'testnet11', CHAIN_ENDPOINTS: 'javascript:alert(1)' });
    expect(config.chainEndpoints).toEqual(['https://testnet11.api.coinset.org']);
  });
});

describe('contentSecurityPolicy', () => {
  it('lists each endpoint origin once and nothing a header could be split with', () => {
    const csp = contentSecurityPolicy([
      'https://a.test/x',
      'https://a.test/y',
      'http://b.test:8080',
    ]);
    expect(csp).toContain(
      "connect-src 'self' https://a.test http://b.test:8080 https://api.coinset.org " +
        'https://testnet11.api.coinset.org https://api.xchandles.com;',
    );
    expect(csp).not.toMatch(/[\r\n]/);
  });
});

describe('bytes', () => {
  it('decodes a 48-byte base64url key', () => {
    const key = parsePublicKey(`${'_'.repeat(63)}-`);
    expect(key).toHaveLength(48);
    expect(key?.[0]).toBe(0xff);
    expect(key?.[47]).toBe(0xfe);
    expect(parsePublicKey('A'.repeat(64))).toEqual(new Uint8Array(48));
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      'A'.repeat(63),
      'A'.repeat(65),
      `${'A'.repeat(63)}=`,
      `${'A'.repeat(63)}/`,
    ]) {
      expect(parsePublicKey(bad)).toBeNull();
    }
  });

  it('writes 0x-prefixed lowercase hex', () => {
    expect(toHex0x(new Uint8Array([0, 0xab, 0xff]))).toBe('0x00abff');
  });
});
