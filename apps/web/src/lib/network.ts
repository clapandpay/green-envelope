// SPDX-License-Identifier: AGPL-3.0-or-later
// Which chain the app talks to. In production each chain has its own site: mainnet at
// envelope.clapandpay.com, testnet at testnet.envelope.clapandpay.com. Both use the same
// passkey (its domain is clapandpay.com), and each keeps its own browser storage. Elsewhere
// (localhost, previews, self-hosted) one site serves both, chosen by `?net=testnet`, a sticky
// parameter in the router.

/** A Chia network, by the names the rest of the app uses. */
export type NetworkName = 'mainnet' | 'testnet11';

// What a person might type in the address bar, and what it means. Anything else is ignored.
const ALIASES: Readonly<Record<string, NetworkName>> = {
  main: 'mainnet',
  mainnet: 'mainnet',
  test: 'testnet11',
  testnet: 'testnet11',
  testnet11: 'testnet11',
};

/** The network named by `?net=`, or null when it says nothing we recognise. Pure. */
export function networkFromSearch(search: string): NetworkName | null {
  const value = new URLSearchParams(search).get('net');
  if (value === null) return null;
  return ALIASES[value.trim().toLowerCase()] ?? null;
}

/** `?net=` wins, then the build's `VITE_NETWORK`, then mainnet. Pure. */
export function resolveNetwork(search: string, built: string | undefined): NetworkName {
  const asked = networkFromSearch(search);
  if (asked !== null) return asked;
  const fromBuild = built === undefined ? null : (ALIASES[built.trim().toLowerCase()] ?? null);
  return fromBuild ?? 'mainnet';
}

/**
 * Adds `net=` to a link when it is not for mainnet, so that opening it lands on the same chain
 * it was made on. Mainnet links stay clean, because that is almost every link. Pure.
 */
export function withNetwork(link: string, network: NetworkName): string {
  if (network === 'mainnet') return link;
  const url = new URL(link);
  url.searchParams.set('net', network === 'testnet11' ? 'testnet' : network);
  return url.toString();
}

/** The network a build was made for, ignoring the link. Mainnet unless it says otherwise. Pure. */
export function builtNetwork(built: string | undefined): NetworkName {
  if (built === undefined) return 'mainnet';
  return ALIASES[built.trim().toLowerCase()] ?? 'mainnet';
}

/** The site of each network, where the deployment has one (`VITE_MAINNET_URL`, `VITE_TESTNET_URL`). */
export type Sites = Readonly<Record<NetworkName, string>>;

/** The production sites, unless the build names others. */
export function sitesFrom(env: { VITE_MAINNET_URL?: string; VITE_TESTNET_URL?: string }): Sites {
  return {
    mainnet: new URL(env.VITE_MAINNET_URL ?? 'https://envelope.clapandpay.com').origin,
    testnet11: new URL(env.VITE_TESTNET_URL ?? 'https://testnet.envelope.clapandpay.com').origin,
  };
}

/** Which network a site is for, or null when this origin is not one of them. Pure. */
export function siteNetwork(origin: string, sites: Sites): NetworkName | null {
  if (origin === sites.mainnet) return 'mainnet';
  if (origin === sites.testnet11) return 'testnet11';
  return null;
}

/**
 * Where "use the other network" goes. On a network's own site: the same page on the other
 * site, without `net`, keeping the fragment (an envelope's secret never reaches a server). A
 * claim link belongs to the chain it was made on, so from an envelope it goes to the wallet.
 * Anywhere else: the same page with `?net=`. Pure.
 */
export function switchNetworkUrl(
  where: { origin: string; pathname: string; search: string },
  to: NetworkName,
  sites: Sites,
): string {
  const path = where.pathname.startsWith('/g/') ? '/' : where.pathname;
  const params = new URLSearchParams(where.search);
  if (siteNetwork(where.origin, sites) !== null) {
    params.delete('net');
    const query = params.toString();
    return `${sites[to]}${path}${query === '' ? '' : `?${query}`}`;
  }
  params.set('net', to === 'mainnet' ? 'main' : 'testnet');
  return `${path}?${params.toString()}`;
}

/**
 * On a network's own site, a link that asks for the other network (`?net=`, from before the
 * sites were split) belongs on the other site: the same path and fragment there. Null when the
 * page is where it belongs. Pure.
 */
export function misplacedLink(
  where: { origin: string; pathname: string; search: string; hash: string },
  sites: Sites,
): string | null {
  const here = siteNetwork(where.origin, sites);
  const asked = networkFromSearch(where.search);
  if (here === null || asked === null || asked === here) return null;
  const params = new URLSearchParams(where.search);
  params.delete('net');
  const query = params.toString();
  return `${sites[asked]}${where.pathname}${query === '' ? '' : `?${query}`}${where.hash}`;
}
