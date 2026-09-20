// SPDX-License-Identifier: AGPL-3.0-or-later
// Which chain the app talks to. Mainnet unless the link says otherwise: `?net=testnet`.
// Nothing in the interface offers the choice, and nothing remembers it beyond the current link:
// the people this is built for never meet a network, and the flag follows a tester around
// because `net` is a sticky parameter in the router.

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
