// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyPushError, createChainClient } from './client';
import { ChainError } from './errors';
import { BLOCKCHAIN_STATE, COIN_RECORDS } from './fixtures/testnet11';
import { fakeFetch, hangs, json, unreachable } from './test-helpers';
import type { SpendBundle } from './types';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

const ph = (fill: number) => new Uint8Array(32).fill(fill);
const hex = (fill: number) => `0x${fill.toString(16).padStart(2, '0').repeat(32)}`;

const record = (over: Record<string, unknown> = {}) => ({
  coin: { parent_coin_info: hex(1), puzzle_hash: hex(2), amount: 1500 },
  coinbase: false,
  confirmed_block_index: 10,
  spent: false,
  spent_block_index: 0,
  timestamp: 1710509237,
  ...over,
});

const bundle: SpendBundle = {
  coinSpends: [
    {
      coin: { parentCoinInfo: ph(1), puzzleHash: ph(2), amount: 1500n },
      puzzleReveal: Uint8Array.of(0xff, 0x01, 0x80),
      solution: Uint8Array.of(0x80),
    },
  ],
  aggregatedSignature: new Uint8Array(96).fill(0xc0),
};

async function codeOf(promise: Promise<unknown>): Promise<ChainError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof ChainError))
    throw new Error(`expected a ChainError, got ${String(error)}`);
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createChainClient', () => {
  it('refuses an empty endpoint list', () => {
    expect(() => createChainClient({ endpoints: [] })).toThrow(TypeError);
    expect(() => createChainClient({ endpoints: ['/'] })).toThrow(TypeError);
  });

  it('uses the global fetch by default', async () => {
    const { fetch, seen } = fakeFetch({ [A]: json(BLOCKCHAIN_STATE) });
    vi.stubGlobal('fetch', fetch);
    expect(await createChainClient({ endpoints: [A] }).peakHeight()).toBe(4708587);
    expect(seen).toHaveLength(1);
  });
});

describe('peakHeight', () => {
  it('reads blockchain_state.peak.height from a live-shaped body with a POST of {}', async () => {
    const { fetch, seen } = fakeFetch({ [A]: json(BLOCKCHAIN_STATE) });
    const client = createChainClient({ endpoints: [`${A}//`], fetch });
    expect(await client.peakHeight()).toBe(4708587);
    expect(seen).toEqual([
      {
        url: `${A}/get_blockchain_state`,
        method: 'POST',
        body: {},
        contentType: 'application/json',
      },
    ]);
  });

  it.each([
    ['not json', '<html>captive portal</html>'],
    ['an array', '[]'],
    ['no state', '{"success":true}'],
    ['no peak (node still starting)', '{"blockchain_state":{"peak":null},"success":true}'],
    ['a fractional height', '{"blockchain_state":{"peak":{"height":1.5}},"success":true}'],
  ])('reports bad_response for %s', async (_, body) => {
    const { fetch } = fakeFetch({ [A]: json(body) });
    const error = await codeOf(createChainClient({ endpoints: [A], fetch }).peakHeight());
    expect(error.code).toBe('bad_response');
  });
});

describe('coinRecordsByPuzzleHashes', () => {
  it('parses the live fixture', async () => {
    const { fetch } = fakeFetch({ [A]: json(COIN_RECORDS) });
    const records = await createChainClient({ endpoints: [A], fetch }).coinRecordsByPuzzleHashes([
      ph(0),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      coin: {
        parentCoinInfo: Uint8Array.from(
          Buffer.from('0edfcfe8209e81afe4c7bddafb58f5e12e981b2690c5e621588fa2a986d6afa2', 'hex'),
        ),
        puzzleHash: ph(0),
        amount: 0n,
      },
      confirmedHeight: 492429,
      spentHeight: null,
      timestamp: 1710509237,
    });
  });

  it('sends one batched request and defaults to unspent only', async () => {
    const { fetch, seen } = fakeFetch({ [A]: json({ coin_records: [], success: true }) });
    const client = createChainClient({ endpoints: [A], fetch });
    const hashes = Array.from({ length: 100 }, (_, i) => ph(i));
    expect(await client.coinRecordsByPuzzleHashes(hashes)).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${A}/get_coin_records_by_puzzle_hashes`);
    expect(seen[0]?.body).toEqual({
      puzzle_hashes: hashes.map((_, i) => hex(i)),
      include_spent_coins: false,
    });
  });

  it('passes includeSpent and maps spent records', async () => {
    const body = { coin_records: [record({ spent: true, spent_block_index: 42 })], success: true };
    const { fetch, seen } = fakeFetch({ [A]: json(body) });
    const client = createChainClient({ endpoints: [A], fetch });
    const records = await client.coinRecordsByPuzzleHashes([ph(2)], { includeSpent: true });
    expect(seen[0]?.body).toMatchObject({ include_spent_coins: true });
    expect(records[0]?.spentHeight).toBe(42);
    expect(records[0]?.coin.amount).toBe(1500n);
  });

  it('keeps amounts beyond 2^53 exact', async () => {
    const text = JSON.stringify({ coin_records: [record()], success: true }).replace(
      '"amount":1500',
      '"amount": 18446744073709551615',
    );
    const { fetch } = fakeFetch({ [A]: json(text) });
    const records = await createChainClient({ endpoints: [A], fetch }).coinRecordsByPuzzleHashes([
      ph(2),
    ]);
    expect(records[0]?.coin.amount).toBe(18446744073709551615n);
  });

  it('splits more than 100 puzzle hashes into pages and keeps their order', async () => {
    const { fetch, seen } = fakeFetch({
      [A]: [
        json({ coin_records: [record({ confirmed_block_index: 1 })], success: true }),
        json({ coin_records: [record({ confirmed_block_index: 2 })], success: true }),
      ],
    });
    const client = createChainClient({ endpoints: [A], fetch });
    const records = await client.coinRecordsByPuzzleHashes(
      Array.from({ length: 101 }, (_, i) => ph(i)),
    );
    expect(seen).toHaveLength(2);
    expect(records.map((r) => r.confirmedHeight)).toEqual([1, 2]);
  });

  it('makes no request for an empty list and rejects a short puzzle hash', async () => {
    const { fetch, seen } = fakeFetch({});
    const client = createChainClient({ endpoints: [A], fetch });
    expect(await client.coinRecordsByPuzzleHashes([])).toEqual([]);
    await expect(client.coinRecordsByPuzzleHashes([new Uint8Array(31)])).rejects.toThrow(
      RangeError,
    );
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['coin_records missing', { success: true }],
    ['a record that is not an object', { coin_records: [7] }],
    ['a missing coin', { coin_records: [record({ coin: undefined })] }],
    [
      'a short hash',
      { coin_records: [record({ coin: { ...record().coin, puzzle_hash: '0x00' } })] },
    ],
    [
      'bad hex',
      { coin_records: [record({ coin: { ...record().coin, puzzle_hash: 'zz'.repeat(32) } })] },
    ],
    ['odd hex', { coin_records: [record({ coin: { ...record().coin, puzzle_hash: '0x0' } })] }],
    ['a negative amount', { coin_records: [record({ coin: { ...record().coin, amount: -1 } })] }],
    ['a string amount', { coin_records: [record({ coin: { ...record().coin, amount: '12x' } })] }],
    ['spent as a number', { coin_records: [record({ spent: 1 })] }],
    ['a string height', { coin_records: [record({ confirmed_block_index: '10' })] }],
  ])('reports bad_response for %s', async (_, body) => {
    const { fetch } = fakeFetch({ [A]: json(body) });
    const error = await codeOf(
      createChainClient({ endpoints: [A], fetch }).coinRecordsByPuzzleHashes([ph(2)]),
    );
    expect(error.code).toBe('bad_response');
  });
});

describe('coinRecordByName', () => {
  it('returns the record', async () => {
    const { fetch, seen } = fakeFetch({ [A]: json({ coin_record: record(), success: true }) });
    const found = await createChainClient({ endpoints: [A], fetch }).coinRecordByName(ph(9));
    expect(seen[0]?.url).toBe(`${A}/get_coin_record_by_name`);
    expect(seen[0]?.body).toEqual({ name: hex(9) });
    expect(found?.confirmedHeight).toBe(10);
  });

  it('returns null for "not found" without asking another endpoint', async () => {
    const { fetch, seen } = fakeFetch({
      [A]: json({ success: false, error: `Coin record ${hex(9)} not found` }, 400),
      [B]: json({ coin_record: record(), success: true }),
    });
    const client = createChainClient({ endpoints: [A, B], fetch });
    expect(await client.coinRecordByName(ph(9))).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('returns null for a null record', async () => {
    const { fetch } = fakeFetch({ [A]: json({ coin_record: null, success: true }) });
    expect(await createChainClient({ endpoints: [A], fetch }).coinRecordByName(ph(9))).toBeNull();
  });
});

describe('endpoint fallback', () => {
  const ok = json(BLOCKCHAIN_STATE);

  it.each([
    ['a network error', unreachable],
    ['HTTP 503', json({ error: 'down' }, 503)],
    ['HTTP 429 without a node body', json('slow down', 429)],
    ['success:false on a read', json({ success: false, error: 'database is locked' })],
    ['a malformed body', json('<html>')],
  ])('falls through to the next endpoint on %s', async (_, reply) => {
    const { fetch, seen } = fakeFetch({ [A]: reply, [B]: ok });
    expect(await createChainClient({ endpoints: [A, B], fetch }).peakHeight()).toBe(4708587);
    expect(seen.map((s) => s.url)).toEqual([
      `${A}/get_blockchain_state`,
      `${B}/get_blockchain_state`,
    ]);
  });

  it('falls through on a timeout and aborts the slow request', async () => {
    const { fetch, seen } = fakeFetch({ [A]: hangs, [B]: ok });
    const client = createChainClient({ endpoints: [A, B], fetch, timeoutMs: 10 });
    expect(await client.peakHeight()).toBe(4708587);
    expect(seen).toHaveLength(2);
  });

  it('reports network with the timeout in the detail when nothing answers', async () => {
    const { fetch } = fakeFetch({ [A]: hangs, [B]: unreachable });
    const error = await codeOf(
      createChainClient({ endpoints: [A, B], fetch, timeoutMs: 10 }).peakHeight(),
    );
    expect(error.code).toBe('network');
    const { fetch: fetch2 } = fakeFetch({ [A]: hangs });
    const timeout = await codeOf(
      createChainClient({ endpoints: [A], fetch: fetch2, timeoutMs: 10 }).peakHeight(),
    );
    expect(timeout.detail).toContain('timed out after 10 ms');
  });

  it('reports the most informative failure when every endpoint fails', async () => {
    const { fetch } = fakeFetch({
      [A]: json({ success: false, error: 'database is locked' }),
      [B]: json('<html>'),
      [C]: unreachable,
    });
    const error = await codeOf(createChainClient({ endpoints: [A, B, C], fetch }).peakHeight());
    expect(error.code).toBe('rejected');
    expect(error.detail).toBe('database is locked');
  });

  it('remembers the last healthy endpoint, then the rest in configured order', async () => {
    const { fetch, seen } = fakeFetch({
      [A]: unreachable,
      [B]: unreachable,
      [C]: [ok, ok, unreachable],
    });
    const client = createChainClient({ endpoints: [A, B, C], fetch });
    const hosts = () => seen.splice(0).map((s) => new URL(s.url).host);

    await client.peakHeight();
    expect(hosts()).toEqual(['a.example', 'b.example', 'c.example']);
    await client.peakHeight();
    expect(hosts()).toEqual(['c.example']);
    await expect(client.peakHeight()).rejects.toMatchObject({ code: 'network' });
    expect(hosts()).toEqual(['c.example', 'a.example', 'b.example']);
  });

  it('rejects with a RangeError, not a ChainError, for an amount JSON cannot carry', async () => {
    const { fetch, seen } = fakeFetch({ [A]: ok });
    const client = createChainClient({ endpoints: [A], fetch });
    const huge: SpendBundle = {
      coinSpends: bundle.coinSpends.map((s) => ({ ...s, coin: { ...s.coin, amount: 2n ** 53n } })),
      aggregatedSignature: bundle.aggregatedSignature,
    };
    await expect(client.pushTx(huge)).rejects.toThrow(RangeError);
    await expect(client.coinRecordByName(new Uint8Array(3))).rejects.toThrow(RangeError);
    expect(seen).toHaveLength(0);
  });

  it('lets a programming error inside fetch handling surface as network, never as success', async () => {
    const fetch: typeof globalThis.fetch = () => {
      throw new Error('boom');
    };
    const error = await codeOf(createChainClient({ endpoints: [A], fetch }).peakHeight());
    expect(error).toMatchObject({ code: 'network', detail: `${A}: boom` });
  });
});

describe('pushTx', () => {
  it('posts the snake_case bundle and maps SUCCESS', async () => {
    const { fetch, seen } = fakeFetch({ [A]: json({ status: 'SUCCESS', success: true }) });
    const result = await createChainClient({ endpoints: [A], fetch }).pushTx(bundle);
    expect(result).toEqual({ status: 'success' });
    expect(seen[0]?.url).toBe(`${A}/push_tx`);
    expect(seen[0]?.body).toEqual({
      spend_bundle: {
        coin_spends: [
          {
            coin: { parent_coin_info: hex(1), puzzle_hash: hex(2), amount: 1500 },
            puzzle_reveal: '0xff0180',
            solution: '0x80',
          },
        ],
        aggregated_signature: `0x${'c0'.repeat(96)}`,
      },
    });
  });

  it('maps PENDING and rejects an unknown status', async () => {
    const pending = fakeFetch({ [A]: json({ status: 'PENDING', success: true }) });
    expect(
      await createChainClient({ endpoints: [A], fetch: pending.fetch }).pushTx(bundle),
    ).toEqual({ status: 'pending' });
    const odd = fakeFetch({ [A]: json({ status: 'FAILED', success: true }) });
    const error = await codeOf(
      createChainClient({ endpoints: [A], fetch: odd.fetch }).pushTx(bundle),
    );
    expect(error.code).toBe('bad_response');
  });

  it.each([
    ['DOUBLE_SPEND', 'double_spend'],
    ['MEMPOOL_CONFLICT', 'double_spend'],
    ['UNKNOWN_UNSPENT', 'unknown_coin'],
    ['BAD_AGGREGATE_SIGNATURE', 'rejected'],
  ])('maps %s to %s and never retries it elsewhere', async (nodeCode, code) => {
    const detail = `Failed to include transaction abc, error ${nodeCode}`;
    const { fetch, seen } = fakeFetch({
      [A]: json({ success: false, error: detail }, 400),
      [B]: json({ status: 'SUCCESS', success: true }),
    });
    const error = await codeOf(createChainClient({ endpoints: [A, B], fetch }).pushTx(bundle));
    expect(error.code).toBe(code);
    expect(error.detail).toBe(detail);
    expect(seen).toHaveLength(1);
  });

  it('falls through to the next endpoint on transport failure', async () => {
    const { fetch, seen } = fakeFetch({
      [A]: json('bad gateway', 502),
      [B]: json({ status: 'SUCCESS', success: true }),
    });
    expect(await createChainClient({ endpoints: [A, B], fetch }).pushTx(bundle)).toEqual({
      status: 'success',
    });
    expect(seen).toHaveLength(2);
  });

  it('treats a syncing node as not definitive', async () => {
    const { fetch } = fakeFetch({
      [A]: json({ success: false, error: 'NO_TRANSACTIONS_WHILE_SYNCING' }),
      [B]: json({ status: 'SUCCESS', success: true }),
    });
    expect(await createChainClient({ endpoints: [A, B], fetch }).pushTx(bundle)).toEqual({
      status: 'success',
    });
  });

  it('remembers an endpoint that gave a definitive rejection as healthy', async () => {
    const { fetch, seen } = fakeFetch({
      [A]: unreachable,
      [B]: [json({ success: false, error: 'DOUBLE_SPEND' }), json(BLOCKCHAIN_STATE)],
    });
    const client = createChainClient({ endpoints: [A, B], fetch });
    await expect(client.pushTx(bundle)).rejects.toMatchObject({ code: 'double_spend' });
    seen.splice(0);
    await client.peakHeight();
    expect(seen.map((s) => s.url)).toEqual([`${B}/get_blockchain_state`]);
  });

  it('classifies error texts', () => {
    expect(classifyPushError('ALREADY_INCLUDING_TRANSACTION')).toEqual({
      value: { status: 'success' },
    });
    expect(classifyPushError('Too Many Requests')).toBeNull();
    expect(classifyPushError('')).toMatchObject({ code: 'rejected' });
  });

  it('uses a placeholder when the node gives no error text', async () => {
    const { fetch } = fakeFetch({ [A]: json({ success: false }) });
    const error = await codeOf(createChainClient({ endpoints: [A], fetch }).pushTx(bundle));
    expect(error).toMatchObject({ code: 'rejected', detail: 'unknown node error' });
  });
});

describe('a node that wants a key', () => {
  it('gets it on the first endpoint only', async () => {
    const seen: (string | null)[] = [];
    const client = createChainClient({
      endpoints: ['https://keyed.test', 'https://public.test'],
      apiKey: 'pk',
      fetch: async (input, init) => {
        seen.push(new Headers(init?.headers).get('authorization'));
        return String(input).startsWith('https://keyed.test')
          ? new Response('unauthorized', { status: 401 })
          : json(BLOCKCHAIN_STATE);
      },
    });
    await client.peakHeight();
    expect(seen).toEqual(['Bearer pk', null]);
  });
});
