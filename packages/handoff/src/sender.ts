// SPDX-License-Identifier: AGPL-3.0-or-later
// Handoff, the sending side: the clapandpay.com page. See receiver.ts for the protocol.
import {
  additionalData,
  fromBase64Url,
  HANDOFF,
  HandoffError,
  type HandoffPayload,
  sharedKey,
  toBase64Url,
} from './receiver';

/** A request as the page received it in `/connect#v=2&k=...&n=...`. */
export interface ParsedRequest {
  receiverKey: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
}

/** Reads the request out of the page's URL fragment. Throws `HandoffError('bad_request')`. */
export async function parseHandoffRequest(hash: string): Promise<ParsedRequest> {
  if (!hash.startsWith('#')) throw new HandoffError('bad_request');
  const params = new URLSearchParams(hash.slice(1));
  const receiverKey = fromBase64Url(params.get('k') ?? '');
  const nonce = fromBase64Url(params.get('n') ?? '');
  if (params.get('v') !== '2' || receiverKey === null || nonce === null) {
    throw new HandoffError('bad_request');
  }
  if (nonce.length !== HANDOFF.NONCE_BYTES) throw new HandoffError('bad_request');
  // An uncompressed P-256 point: 0x04 and two coordinates. importKey checks it is on the curve.
  if (receiverKey.length !== HANDOFF.RAW_KEY_BYTES || receiverKey[0] !== 0x04) {
    throw new HandoffError('bad_request');
  }
  try {
    await crypto.subtle.importKey('raw', receiverKey, HANDOFF.CURVE, false, []);
  } catch {
    throw new HandoffError('bad_request');
  }
  return { receiverKey, nonce };
}

/**
 * Encrypts `payload` so that only the app that made `request` can read it, and returns the
 * return link that carries it. The page opens that link and nothing else: there is no text to
 * copy.
 */
export async function sealHandoffResponse(
  request: ParsedRequest,
  payload: HandoffPayload,
): Promise<{ returnUrl: string }> {
  const { subtle } = crypto;
  const pair = await subtle.generateKey(HANDOFF.CURVE, false, ['deriveBits']);
  const senderRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const key = await sharedKey(
    pair.privateKey,
    request.receiverKey,
    request.receiverKey,
    senderRaw,
    request.nonce,
  );
  const iv = crypto.getRandomValues(new Uint8Array(HANDOFF.IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  let sealed: Uint8Array;
  try {
    sealed = new Uint8Array(
      await subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: additionalData(request.nonce) },
        key,
        plain,
      ),
    );
  } finally {
    plain.fill(0);
  }
  const out = new Uint8Array(senderRaw.length + iv.length + sealed.length);
  out.set(senderRaw, 0);
  out.set(iv, senderRaw.length);
  out.set(sealed, senderRaw.length + iv.length);
  return { returnUrl: `${HANDOFF.RETURN_URL}#${HANDOFF.RESPONSE_PREFIX}${toBase64Url(out)}` };
}
