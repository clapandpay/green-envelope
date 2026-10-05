// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { PASSKEY_DOMAIN, relyingPartyId } from './relying-party';

describe('relyingPartyId', () => {
  it('names clapandpay.com on the domain and on its subdomains', () => {
    expect(relyingPartyId('clapandpay.com')).toBe(PASSKEY_DOMAIN);
    expect(relyingPartyId('envelope.clapandpay.com')).toBe(PASSKEY_DOMAIN);
    expect(relyingPartyId('a.b.clapandpay.com')).toBe(PASSKEY_DOMAIN);
  });

  it('ignores case and a trailing dot', () => {
    expect(relyingPartyId('Envelope.ClapAndPay.com.')).toBe(PASSKEY_DOMAIN);
  });

  it('leaves every other host to the browser', () => {
    for (const host of ['localhost', '127.0.0.1', 'example.com', 'clapandpay.com.evil.example']) {
      expect(relyingPartyId(host)).toBeUndefined();
    }
  });

  it('is not fooled by a host that merely ends in the same letters', () => {
    expect(relyingPartyId('notclapandpay.com')).toBeUndefined();
    expect(relyingPartyId('evilclapandpay.com')).toBeUndefined();
  });
});
