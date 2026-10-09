// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createHandoffRequest,
  HANDOFF,
  type HandoffPayload,
  isReturnLink,
  parseHandoffRequest,
  sealHandoffResponse,
} from '.';

const WORDS =
  'history indoor salmon ripple side tent tourist decline venture turn diary sad awkward minute barrel much dumb asset milk mandate coach ritual reflect any';

const payload: HandoffPayload = {
  v: 2,
  network: 'testnet11',
  address: 'txch1vwcxaqjcr0n6022h0yrw3wp6vghns6cdd0jnl7g9ehhn27r8kf3qzhsmh3',
  words: WORDS,
};

async function roundTrip(now?: () => number) {
  const request = await createHandoffRequest('https://clapandpay.test/', now ? { now } : {});
  const parsed = await parseHandoffRequest(new URL(request.url).hash);
  const { returnUrl } = await sealHandoffResponse(parsed, payload);
  return { request, parsed, returnUrl };
}

/** The answer text after `#`. */
const answerIn = (returnUrl: string) => new URL(returnUrl).hash.slice(1);

describe('handoff v2', () => {
  it('carries the words from the page to the app that asked, through the return link', async () => {
    const { request, returnUrl } = await roundTrip();
    // Key and nonce are in the fragment: a browser never sends it to the server.
    expect(request.url).toMatch(
      /^https:\/\/clapandpay\.test\/connect#v=2&k=[A-Za-z0-9_-]{87}&n=[A-Za-z0-9_-]{22}$/,
    );
    expect(returnUrl.startsWith(`${HANDOFF.RETURN_URL}#cp2.`)).toBe(true);
    expect(isReturnLink(returnUrl)).toBe(true);
    expect(await request.open(returnUrl)).toEqual(payload);
  });

  it('answers only on the clapandpay.com return path', async () => {
    const { returnUrl } = await roundTrip();
    const url = new URL(returnUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://clapandpay.com/klimper/return');
    expect(url.search).toBe('');
    expect(isReturnLink('https://clapandpay.com/klimper/returned#x')).toBe(false);
    expect(isReturnLink('https://evil.example/klimper/return#x')).toBe(false);
  });

  it('opens once: the one-time key is forgotten after the first answer', async () => {
    const { request, returnUrl } = await roundTrip();
    await request.open(returnUrl);
    await expect(request.open(returnUrl)).rejects.toMatchObject({ code: 'used' });
  });

  it('opens nothing after two minutes, and forgets the key then', async () => {
    let clock = 1_000_000;
    const { request, returnUrl } = await roundTrip(() => clock);
    clock += HANDOFF.REQUEST_TTL_MS + 1;
    await expect(request.open(returnUrl)).rejects.toMatchObject({ code: 'expired' });
    clock = 1_000_000; // even a clock set back cannot bring the key back
    await expect(request.open(returnUrl)).rejects.toMatchObject({ code: 'used' });
  });

  it('cannot be opened by any other app instance, or for another nonce', async () => {
    const { returnUrl, parsed } = await roundTrip();
    const thief = await createHandoffRequest('https://clapandpay.test');
    await expect(thief.open(returnUrl)).rejects.toMatchObject({ code: 'wrong_receiver' });

    // The same app key with another nonce: the nonce is bound into the key and the seal.
    const request = await createHandoffRequest('https://clapandpay.test');
    const own = await parseHandoffRequest(new URL(request.url).hash);
    const otherNonce = { receiverKey: own.receiverKey, nonce: parsed.nonce };
    const { returnUrl: replayed } = await sealHandoffResponse(otherNonce, payload);
    await expect(request.open(replayed)).rejects.toMatchObject({ code: 'wrong_receiver' });
  });

  it('refuses an answer that was changed on the way', async () => {
    const { request, returnUrl } = await roundTrip();
    const bytes = Buffer.from(answerIn(returnUrl).slice(4), 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    await expect(request.open(`cp2.${bytes.toString('base64url')}`)).rejects.toMatchObject({
      code: 'wrong_receiver',
    });
    // Refusing a forgery does not use the request up: the real answer still opens.
    expect(await request.open(returnUrl)).toEqual(payload);
  });

  it('reveals nothing in the return link', async () => {
    const { returnUrl } = await roundTrip();
    const raw = Buffer.from(answerIn(returnUrl).slice(4), 'base64url').toString('latin1');
    for (const word of ['history', 'salmon', 'words', payload.address]) {
      expect(returnUrl).not.toContain(word);
      expect(raw).not.toContain(word);
    }
  });

  it('gives every handoff a fresh key and nonce', async () => {
    const a = await roundTrip();
    const b = await roundTrip();
    expect(a.request.url).not.toBe(b.request.url);
    expect(a.returnUrl).not.toBe(b.returnUrl);
  });

  it('refuses anything that is not an answer, and a payload without 24 words', async () => {
    const { request, parsed } = await roundTrip();
    for (const junk of ['', 'hello', 'cp2.', 'cp2.!!!', 'cp1.AAAA', `cp2.${'A'.repeat(40)}`]) {
      await expect(request.open(junk)).rejects.toMatchObject({ code: 'bad_response' });
    }
    const short = await sealHandoffResponse(parsed, { ...payload, words: 'abandon art' });
    await expect(request.open(short.returnUrl)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('reads the request from the fragment only, and refuses a broken one before any prompt', async () => {
    const url = new URL((await createHandoffRequest('https://x.test')).url);
    const params = new URLSearchParams(url.hash.slice(1));
    const k = params.get('k');
    const n = params.get('n');
    const notOnCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
    for (const search of [
      `?${url.hash.slice(1)}`,
      '',
      '#v=2',
      `#v=1&k=${k}&n=${n}`,
      `#v=2&k=${k}`,
      `#v=2&k=${k}&n=AAAA`,
      `#v=2&k=${notOnCurve}&n=${n}`,
    ]) {
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
