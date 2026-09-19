// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ChainLookupError, createChainLookup, parseCoinRecords } from './chain';

const RECORDS = {
  success: true,
  coin_records: [
    { coin: { amount: 1000, parent_coin_info: '0x00', puzzle_hash: '0x01' }, spent: false },
    { coin: { amount: 2500, parent_coin_info: '0x00', puzzle_hash: '0x02' }, spent: true },
  ],
};
const HASHES = [new Uint8Array(32).fill(0xab)];
const live = () => ({ signal: new AbortController().signal });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('parseCoinRecords', () => {
  it('reads amount and spent', () => {
    expect(parseCoinRecords(RECORDS)).toEqual([
      { amount: 1000n, spent: false },
      { amount: 2500n, spent: true },
    ]);
  });

  it.each([
    null,
    'x',
    { success: false, coin_records: [] },
    { success: true },
    { success: true, coin_records: [{ coin: { amount: '1' }, spent: false }] },
    { success: true, coin_records: [{ coin: { amount: 1 } }] },
  ])('rejects %j', (body) => {
    expect(parseCoinRecords(body)).toBeNull();
  });
});

describe('createChainLookup', () => {
  it('sends one batched request in the Coinset shape', async () => {
    const fetchFake = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(RECORDS)));
    const chain = createChainLookup({
      endpoints: ['https://a.test'],
      fetch: fetchFake,
      attemptTimeoutMs: 1000,
    });
    expect(await chain.coinRecordsByPuzzleHashes(HASHES, live())).toHaveLength(2);
    expect(fetchFake).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFake.mock.calls[0] ?? [];
    expect(url).toBe('https://a.test/get_coin_records_by_puzzle_hashes');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      puzzle_hashes: [`0x${'ab'.repeat(32)}`],
      include_spent_coins: true,
    });
  });

  it('falls back on transport failure, 5xx and unusable answers', async () => {
    const fetchFake = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({ success: false }))
      .mockResolvedValueOnce(jsonResponse(RECORDS));
    const chain = createChainLookup({
      endpoints: ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test'],
      fetch: fetchFake,
      attemptTimeoutMs: 1000,
    });
    expect(await chain.coinRecordsByPuzzleHashes(HASHES, live())).toHaveLength(2);
    expect(fetchFake.mock.calls.map(([url]) => url)).toEqual([
      'https://a.test/get_coin_records_by_puzzle_hashes',
      'https://b.test/get_coin_records_by_puzzle_hashes',
      'https://c.test/get_coin_records_by_puzzle_hashes',
      'https://d.test/get_coin_records_by_puzzle_hashes',
    ]);
  });

  it('throws a typed error when every endpoint fails', async () => {
    const chain = createChainLookup({
      endpoints: ['https://a.test'],
      fetch: () => Promise.reject(new TypeError('down')),
      attemptTimeoutMs: 1000,
    });
    await expect(chain.coinRecordsByPuzzleHashes(HASHES, live())).rejects.toBeInstanceOf(
      ChainLookupError,
    );
  });

  it('times an attempt out and stops once the caller has aborted', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const controller = new AbortController();
    const chain = createChainLookup({
      endpoints: ['https://a.test', 'https://b.test', 'https://c.test'],
      fetch: hanging,
      attemptTimeoutMs: 10,
    });
    const pending = chain.coinRecordsByPuzzleHashes(HASHES, { signal: controller.signal });
    setTimeout(() => controller.abort(), 15);
    await expect(pending).rejects.toBeInstanceOf(ChainLookupError);
    expect(hanging).toHaveBeenCalledTimes(2);
  });
});
