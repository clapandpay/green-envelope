// SPDX-License-Identifier: AGPL-3.0-or-later
// Handoff, the sending side: the clapandpay.com page. See receiver.ts for the protocol.
import {
  checkCodeOf,
  fromBase64Url,
  HANDOFF,
  HandoffError,
  type HandoffPayload,
  sharedKey,
  toBase64Url,
} from './receiver';

/** A request as the page received it in `/connect?v=1&k=...`. */
export interface ParsedRequest {
  receiverKey: Uint8Array<ArrayBuffer>;
  checkCode: string;
}

/** Reads the request out of the page's own URL. Throws `HandoffError('bad_request')`. */
export async function parseHandoffRequest(search: string): Promise<ParsedRequest> {
  const params = new URLSearchParams(search);
  const receiverKey = fromBase64Url(params.get('k') ?? '');
  if (params.get('v') !== '1' || receiverKey === null) throw new HandoffError('bad_request');
  // An uncompressed P-256 point: 0x04 and two coordinates. importKey checks it is on the curve.
  if (receiverKey.length !== HANDOFF.RAW_KEY_BYTES || receiverKey[0] !== 0x04) {
    throw new HandoffError('bad_request');
  }
  try {
    await crypto.subtle.importKey('raw', receiverKey, HANDOFF.CURVE, false, []);
  } catch {
    throw new HandoffError('bad_request');
  }
  return { receiverKey, checkCode: await checkCodeOf(receiverKey) };
}

/** Encrypts `payload` so that only the app that made `request` can read it. */
export async function sealHandoffResponse(
  request: ParsedRequest,
  payload: HandoffPayload,
): Promise<string> {
  const { subtle } = crypto;
  const pair = await subtle.generateKey(HANDOFF.CURVE, false, ['deriveBits']);
  const senderRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const key = await sharedKey(pair.privateKey, request.receiverKey, request.receiverKey, senderRaw);
  const iv = crypto.getRandomValues(new Uint8Array(HANDOFF.IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(HANDOFF.TAG) },
      key,
      plain,
    ),
  );
  plain.fill(0);
  const out = new Uint8Array(senderRaw.length + iv.length + sealed.length);
  out.set(senderRaw, 0);
  out.set(iv, senderRaw.length);
  out.set(sealed, senderRaw.length + iv.length);
  return HANDOFF.RESPONSE_PREFIX + toBase64Url(out);
}
