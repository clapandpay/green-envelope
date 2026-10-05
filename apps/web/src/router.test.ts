// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
import { renderHook } from '@testing-library/preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { matchRoute, navigate, onLinkClick, useRoute, withStickyParams } from './router';

describe('matchRoute', () => {
  it('knows the three routes', () => {
    expect(matchRoute('/')).toEqual({ name: 'wallet' });
    expect(matchRoute('')).toEqual({ name: 'wallet' });
    expect(matchRoute('/new')).toEqual({ name: 'create', amount: null });
    expect(matchRoute('/new/')).toEqual({ name: 'create', amount: null });
    expect(matchRoute('/g/abc_DEF-123')).toEqual({ name: 'claim', id: 'abc_DEF-123' });
    expect(matchRoute('/g/abc/')).toEqual({ name: 'claim', id: 'abc' });
    expect(matchRoute('/hello')).toEqual({ name: 'hello' });
    expect(matchRoute('/hello/')).toEqual({ name: 'hello' });
    expect(matchRoute('/hello', '?net=testnet')).toEqual({ name: 'hello' });
  });

  it('reads the prefilled amount as a bigint, or not at all', () => {
    expect(matchRoute('/new', '?amount=296000000000')).toEqual({
      name: 'create',
      amount: 296_000_000_000n,
    });
    expect(matchRoute('/new', '?amount=90071992547409930001').name).toBe('create');
    for (const bad of ['?amount=-1', '?amount=1.5', '?amount=abc', '?amount=', '?x=1']) {
      expect(matchRoute('/new', bad)).toEqual({ name: 'create', amount: null });
    }
  });

  it('sends everything else to notFound', () => {
    for (const path of ['/g', '/g/', '/g/a/b', '/wallet', '/new/x', '/hello/x']) {
      expect(matchRoute(path), path).toEqual({ name: 'notFound' });
    }
  });
});

describe('withStickyParams', () => {
  it('carries the network along and nothing else', () => {
    expect(withStickyParams('/new', '?net=testnet&x=1')).toBe('/new?net=testnet');
    expect(withStickyParams('/new?amount=5', '?net=testnet')).toBe('/new?amount=5&net=testnet');
    expect(withStickyParams('/new?net=main', '?net=testnet')).toBe('/new?net=main');
    expect(withStickyParams('/', '')).toBe('/');
    // The secret lives in the fragment and must come through untouched.
    expect(withStickyParams('/g/x#secret', '?net=testnet')).toBe('/g/x?net=testnet#secret');
  });

  it('no longer carries a demo switch, because there is no demo to switch to', () => {
    expect(withStickyParams('/new', '?mock=slow')).toBe('/new');
  });
});

describe('navigation', () => {
  beforeEach(() => history.replaceState(null, '', '/'));

  it('re-renders on navigate and on the back button', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'wallet' });
    act(() => navigate('/new?amount=7'));
    expect(result.current).toEqual({ name: 'create', amount: 7n });
    expect(location.pathname).toBe('/new');
    act(() => navigate('/g/abcd', { replace: true }));
    expect(result.current).toEqual({ name: 'claim', id: 'abcd' });
    act(() => {
      history.replaceState(null, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toEqual({ name: 'wallet' });
  });

  it('turns plain link clicks into navigation and leaves modified clicks alone', () => {
    const anchor = document.createElement('a');
    anchor.href = '/new';
    anchor.addEventListener('click', onLinkClick);
    document.body.append(anchor);

    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    anchor.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(location.pathname).toBe('/new');
    anchor.remove();
  });
});
