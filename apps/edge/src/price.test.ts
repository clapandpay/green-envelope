// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  createPriceSource,
  FRESH_SECONDS,
  PRICE_URL,
  parsePrice,
  RETRY_AFTER_SECONDS,
  STALE_IF_ERROR_SECONDS,
} from './price';

const T0 = 1_700_000_000;

function priceResponse(eur: number): Response {
  return new Response(JSON.stringify({ chia: { eur } }));
}

function setup(fetchFake: typeof fetch) {
  const clock = { seconds: T0 };
  const price = createPriceSource({ fetch: fetchFake, now: () => clock.seconds * 1000 });
  return { clock, price };
}

describe('parsePrice', () => {
  it('accepts only a positive finite number', () => {
    expect(parsePrice({ chia: { eur: 12.5 } })).toBe(12.5);
    for (const body of [null, {}, { chia: {} }, { chia: { eur: '1' } }, { chia: { eur: 0 } }]) {
      expect(parsePrice(body)).toBeNull();
    }
  });
});

describe('createPriceSource', () => {
  it('fetches from CoinGecko and caches for 60 s', async () => {
    const fetchFake = vi.fn<typeof fetch>(() => Promise.resolve(priceResponse(10)));
    const { clock, price } = setup(fetchFake);
    expect(await price()).toEqual({ eur: 10, at: T0 });
    expect(fetchFake.mock.calls[0]?.[0]).toBe(PRICE_URL);
    clock.seconds = T0 + FRESH_SECONDS - 1;
    expect(await price()).toEqual({ eur: 10, at: T0 });
    expect(fetchFake).toHaveBeenCalledTimes(1);
    clock.seconds = T0 + FRESH_SECONDS;
    fetchFake.mockResolvedValueOnce(priceResponse(11));
    expect(await price()).toEqual({ eur: 11, at: T0 + FRESH_SECONDS });
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it('shares one upstream call between concurrent requests', async () => {
    let release: (response: Response) => void = () => {};
    const fetchFake = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { price } = setup(fetchFake);
    const all = Promise.all([price(), price(), price()]);
    release(priceResponse(9));
    expect(await all).toEqual([
      { eur: 9, at: T0 },
      { eur: 9, at: T0 },
      { eur: 9, at: T0 },
    ]);
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it('serves a stale quote for up to an hour when upstream fails', async () => {
    const fetchFake = vi.fn<typeof fetch>(() => Promise.resolve(priceResponse(10)));
    const { clock, price } = setup(fetchFake);
    await price();
    fetchFake.mockImplementation(() => Promise.reject(new TypeError('down')));
    clock.seconds = T0 + STALE_IF_ERROR_SECONDS - 1;
    expect(await price()).toEqual({ eur: 10, at: T0 });
    clock.seconds = T0 + STALE_IF_ERROR_SECONDS + RETRY_AFTER_SECONDS;
    expect(await price()).toBeNull();
  });

  it('treats bad statuses and bad bodies as failures', async () => {
    const fetchFake = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('<html>'));
    const { clock, price } = setup(fetchFake);
    expect(await price()).toBeNull();
    clock.seconds += RETRY_AFTER_SECONDS;
    expect(await price()).toBeNull();
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failure and recovers', async () => {
    const fetchFake = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('down')));
    const { clock, price } = setup(fetchFake);
    await price();
    clock.seconds += RETRY_AFTER_SECONDS - 1;
    await price();
    expect(fetchFake).toHaveBeenCalledTimes(1);
    clock.seconds += 1;
    fetchFake.mockResolvedValueOnce(priceResponse(12));
    expect(await price()).toEqual({ eur: 12, at: T0 + RETRY_AFTER_SECONDS });
  });
});
