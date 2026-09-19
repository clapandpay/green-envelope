// SPDX-License-Identifier: AGPL-3.0-or-later
// A history router for three routes. No library.
import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'wallet' }
  | { name: 'create'; amount: bigint | null }
  | { name: 'claim'; id: string }
  | { name: 'notFound' };

const NAVIGATE_EVENT = 'ge:navigate';
/** Query parameters that survive in-app navigation (the demo switch). */
const STICKY_PARAMS = ['mock'];

/** Maps a location to a route. Pure. */
export function matchRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'wallet' };
  if (path === '/new') {
    const amount = new URLSearchParams(search).get('amount');
    return { name: 'create', amount: amount && /^\d{1,30}$/.test(amount) ? BigInt(amount) : null };
  }
  const claim = /^\/g\/([^/]+)$/.exec(path);
  if (claim?.[1]) return { name: 'claim', id: claim[1] };
  return { name: 'notFound' };
}

/** Adds the sticky parameters of `currentSearch` to an in-app path. Pure. */
export function withStickyParams(to: string, currentSearch: string): string {
  const current = new URLSearchParams(currentSearch);
  const url = new URL(to, 'http://local');
  for (const key of STICKY_PARAMS) {
    const value = current.get(key);
    if (value !== null && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Goes to an in-app path. */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = withStickyParams(to, location.search);
  if (opts.replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
  dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Click handler for plain links: in-app navigation unless the person wants a new tab. */
export function onLinkClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== location.origin) return;
  event.preventDefault();
  navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`);
}

/** The current route; re-renders on navigation and on the back button. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => matchRoute(location.pathname, location.search));
  useEffect(() => {
    const update = () => {
      setRoute(matchRoute(location.pathname, location.search));
      scrollTo(0, 0);
    };
    addEventListener('popstate', update);
    addEventListener(NAVIGATE_EVENT, update);
    return () => {
      removeEventListener('popstate', update);
      removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return route;
}
