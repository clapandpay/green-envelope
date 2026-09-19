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
    for (const path of ['/g', '/g/', '/g/a/b', '/wallet', '/new/x']) {
      expect(matchRoute(path), path).toEqual({ name: 'notFound' });
    }
  });
});

describe('withStickyParams', () => {
  it('carries the demo switch along and nothing else', () => {
    expect(withStickyParams('/new', '?mock=slow&x=1')).toBe('/new?mock=slow');
    expect(withStickyParams('/new?amount=5', '?mock=slow')).toBe('/new?amount=5&mock=slow');
    expect(withStickyParams('/new?mock=empty', '?mock=slow')).toBe('/new?mock=empty');
    expect(withStickyParams('/', '')).toBe('/');
    expect(withStickyParams('/g/x#secret', '?mock=a')).toBe('/g/x?mock=a#secret');
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
