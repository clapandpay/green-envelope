// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { createRpcProxy, MAX_BODY_BYTES } from './rpc';

const ENDPOINTS = ['https://a.test', 'https://b.test/rpc'];

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request('https://edge.test/api/rpc/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

function upstream(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function proxyWith(fetchFake: typeof fetch) {
  return createRpcProxy({ fetch: fetchFake, endpoints: ENDPOINTS });
}

describe('createRpcProxy', () => {
  it('passes an allow-listed call and the upstream JSON through', async () => {
    const fetchFake = vi.fn<typeof fetch>(() =>
      Promise.resolve(upstream({ success: true, coin_records: [] })),
    );
    const response = await proxyWith(fetchFake)(
      'get_coin_records_by_puzzle_hashes',
      post('{"puzzle_hashes":["0x00"]}'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, coin_records: [] });
    const [url, init] = fetchFake.mock.calls[0] ?? [];
    expect(url).toBe('https://a.test/get_coin_records_by_puzzle_hashes');
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('{"puzzle_hashes":["0x00"]}');
  });

  it.each([
    'get_coin_records_by_puzzle_hashes',
    'get_coin_record_by_name',
    'get_blockchain_state',
    'push_tx',
  ])('allows %s', async (method) => {
    const response = await proxyWith(() => Promise.resolve(upstream({ success: true })))(
      method,
      post('{}'),
    );
    expect(response.status).toBe(200);
  });

  it.each([
    'get_all_mempool_items',
    'get_coin_records_by_puzzle_hash',
    '',
    'push_tx/../x',
    '__proto__',
  ])('refuses %j without calling upstream', async (method) => {
    const fetchFake = vi.fn<typeof fetch>();
    const response = await proxyWith(fetchFake)(method, post('{}'));
    expect(response.status).toBe(404);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it('requires a JSON content type and a JSON object', async () => {
    const fetchFake = vi.fn<typeof fetch>();
    const proxy = proxyWith(fetchFake);
    const form = post('{}', { 'content-type': 'text/plain' });
    expect((await proxy('push_tx', form)).status).toBe(415);
    expect((await proxy('push_tx', post('{nope'))).status).toBe(400);
    expect((await proxy('push_tx', post('[1]'))).status).toBe(400);
    expect(fetchFake).not.toHaveBeenCalled();
    const charset = post('{}', { 'content-type': 'Application/JSON; charset=utf-8' });
    fetchFake.mockResolvedValueOnce(upstream({ success: true }));
    expect((await proxy('push_tx', charset)).status).toBe(200);
  });

  it('refuses bodies over 256 kB, declared or not', async () => {
    const fetchFake = vi.fn<typeof fetch>();
    const proxy = proxyWith(fetchFake);
    const big = JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect((await proxy('push_tx', post(big))).status).toBe(413);

    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const streamed = new Request('https://edge.test/api/rpc/push_tx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error `duplex` is required by Node for stream bodies and missing from lib.dom.
      duplex: 'half',
    });
    expect((await proxy('push_tx', streamed)).status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it('accepts a body of exactly the limit', async () => {
    const padding = MAX_BODY_BYTES - '{"pad":""}'.length;
    const body = JSON.stringify({ pad: 'x'.repeat(padding) });
    const proxy = proxyWith(() => Promise.resolve(upstream({ success: true })));
    expect((await proxy('push_tx', post(body))).status).toBe(200);
  });

  it('falls back on transport failure and on 5xx', async () => {
    const fetchFake = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(upstream({ success: true, peak: 1 }));
    const response = await proxyWith(fetchFake)('get_blockchain_state', post('{}'));
    expect(await response.json()).toEqual({ success: true, peak: 1 });
    expect(fetchFake.mock.calls.map(([url]) => url)).toEqual([
      'https://a.test/get_blockchain_state',
      'https://b.test/rpc/get_blockchain_state',
    ]);

    fetchFake.mockReset();
    fetchFake
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(upstream({ success: true }));
    expect((await proxyWith(fetchFake)('get_blockchain_state', post('{}'))).status).toBe(200);
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it('answers 502 when every endpoint fails', async () => {
    const proxy = proxyWith(() => Promise.reject(new TypeError('down')));
    const response = await proxy('get_blockchain_state', post('{}'));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, error: 'upstream_unavailable' });
  });

  describe('push_tx', () => {
    it('is not re-sent after a definitive rejection', async () => {
      const verdict = { success: false, error: 'DOUBLE_SPEND' };
      for (const status of [200, 400, 500]) {
        const fetchFake = vi.fn<typeof fetch>(() => Promise.resolve(upstream(verdict, status)));
        const response = await proxyWith(fetchFake)('push_tx', post('{"spend_bundle":{}}'));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual(verdict);
        expect(fetchFake).toHaveBeenCalledTimes(1);
      }
    });

    it('is re-sent when the first endpoint gave no verdict', async () => {
      const fetchFake = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
        .mockResolvedValueOnce(upstream({ success: true, status: 'SUCCESS' }));
      const response = await proxyWith(fetchFake)('push_tx', post('{"spend_bundle":{}}'));
      expect(await response.json()).toEqual({ success: true, status: 'SUCCESS' });
      expect(fetchFake).toHaveBeenCalledTimes(2);
    });
  });

  it('never logs', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    await proxyWith(() => Promise.reject(new TypeError('down')))('push_tx', post('{"s":1}'));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
