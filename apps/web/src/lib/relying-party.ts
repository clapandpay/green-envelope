// SPDX-License-Identifier: AGPL-3.0-or-later
// Which domain the wallet's passkey belongs to. The Klimper app is hard-wired to clapandpay.com
// (its relying party, and the `webcredentials` entry on that domain), and the money handed over
// to it is the same passkey's key, so the web wallet has to use that domain too, not the one
// host it happens to be served from. The app lives on envelope.clapandpay.com, and a page on a
// subdomain may name its parent as the relying party.
//
// Changing this after people have created a wallet strands them: a passkey is bound to its
// relying party for good.

export const PASSKEY_DOMAIN = 'clapandpay.com';

/**
 * The relying-party id for a page on `hostname`: `clapandpay.com` on that domain and every
 * subdomain of it, otherwise undefined, which lets the browser use the page's own host. That
 * keeps localhost, previews and self-hosted installs working, where naming clapandpay.com would
 * be refused. Pure.
 */
export function relyingPartyId(hostname: string): string | undefined {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === PASSKEY_DOMAIN || host.endsWith(`.${PASSKEY_DOMAIN}`)
    ? PASSKEY_DOMAIN
    : undefined;
}
