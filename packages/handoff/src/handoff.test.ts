// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createHandoffRequest,
  type HandoffPayload,
  parseHandoffRequest,
  sealHandoffResponse,
} from '.';

const payload: HandoffPayload = {
  v: 1,
  network: 'testnet11',
  address: 'txch1anxwneg6hlkmv2uff2mnqh0qhcp5g24hkkfh5j6m9w4t7vjejfts5au9zn',
  masterSk: '3f2d5b3d12cda13881eefced740a88d33e0d7acd279c99d53bb6797a9066b2be',
};

async function roundTrip() {
  const request = await createHandoffRequest('https://clapandpay.test/');
  const parsed = await parseHandoffRequest(new URL(request.url).hash);
  const sealed = await sealHandoffResponse(parsed, payload);
  return { request, parsed, response: sealed.response, answerCode: sealed.answerCode };
}

describe('handoff', () => {
  it('carries the wallet from the page to the app that asked, and shows both the same code', async () => {
    const { request, parsed, response, answerCode } = await roundTrip();
    // The key is in the fragment: a browser never sends it to the server.
    expect(request.url).toMatch(/^https:\/\/clapandpay\.test\/connect#v=1&k=[A-Za-z0-9_-]{87}$/);
    expect(parsed.checkCode).toBe(request.checkCode);
    expect(request.checkCode).toMatch(/^\d{6}$/);
    expect(response.startsWith('cp1.')).toBe(true);
    expect(await request.open(`  ${response}\n`)).toEqual({ payload, answerCode });
    expect(answerCode).toMatch(/^\d{6}$/);
  });

  it('gives an answer sealed by anyone else a code the page does not show', async () => {
    const { request, parsed, answerCode } = await roundTrip();
    // Someone who learned the app's key seals a wallet of their own for it.
    const forged = await sealHandoffResponse(parsed, { ...payload, masterSk: 'ab'.repeat(32) });
    expect((await request.open(forged.response)).answerCode).not.toBe(answerCode);
  });

  it('still reads a request from an older app, in the query string', async () => {
    const request = await createHandoffRequest('https://clapandpay.test');
    const query = `?${new URL(request.url).hash.slice(1)}`;
    expect((await parseHandoffRequest(query)).checkCode).toBe(request.checkCode);
  });

  it('reveals nothing in the response text', async () => {
    const { response } = await roundTrip();
    expect(response).not.toContain(payload.masterSk);
    const raw = Buffer.from(response.slice(4), 'base64url').toString('latin1');
    expect(raw).not.toContain(payload.masterSk);
    expect(raw).not.toContain('masterSk');
  });

  it('cannot be opened by any other app instance', async () => {
    const { response } = await roundTrip();
    const thief = await createHandoffRequest('https://clapandpay.test');
    await expect(thief.open(response)).rejects.toMatchObject({ code: 'wrong_receiver' });
  });

  it('refuses a response that was changed on the way', async () => {
    const { request, response } = await roundTrip();
    const bytes = Buffer.from(response.slice(4), 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await expect(request.open(`cp1.${bytes.toString('base64url')}`)).rejects.toMatchObject({
      code: 'wrong_receiver',
    });
  });

  it('gives every handoff a fresh key, so two responses for one wallet differ', async () => {
    const a = await roundTrip();
    const b = await roundTrip();
    expect(a.request.url).not.toBe(b.request.url);
    expect(a.response).not.toBe(b.response);
  });

  it('refuses anything that is not a response', async () => {
    const { request } = await roundTrip();
    for (const junk of ['', 'hello', 'cp1.', 'cp1.!!!', 'cp2.AAAA', `cp1.${'A'.repeat(40)}`]) {
      await expect(request.open(junk)).rejects.toMatchObject({ code: 'bad_response' });
    }
  });

  it('refuses a broken request before anybody is asked for a fingerprint', async () => {
    const url = new URL((await createHandoffRequest('https://x.test')).url);
    const good = new URLSearchParams(url.hash.slice(1)).get('k');
    const notOnCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
    for (const search of ['', '?v=1', `?v=2&k=${good}`, '?v=1&k=AAAA', `?v=1&k=${notOnCurve}`]) {
      await expect(parseHandoffRequest(search)).rejects.toMatchObject({ code: 'bad_request' });
    }
  });
});

describe("Klimper's copy of the receiver", () => {
  const copy = new URL('../../../../klimper/src/lib/clapandpayHandoff.ts', import.meta.url);

  it.skipIf(!existsSync(copy))('is byte for byte the file in this package', () => {
    const original = readFileSync(new URL('./receiver.ts', import.meta.url), 'utf8');
    expect(readFileSync(copy, 'utf8')).toBe(original);
  });
});
