// SPDX-License-Identifier: AGPL-3.0-or-later
// A software stand-in for `navigator.credentials`, for tests: real P-256 keys, real signatures
// over `authenticatorData || sha256(clientDataJSON)`, answers shaped like a browser's. Imported
// as `@ge/passkey-signer/fake`; nothing in the app reaches it.
import type { Bytes } from '@ge/chia';
import { sha256 } from '@ge/chia';
import { p256 } from '@noble/curves/nist.js';

/** How the fake behaves; every field can be changed between calls. */
export interface FakePasskeyOptions {
  /** DOMException name thrown by the next create()/get() calls (e.g. 'NotAllowedError'). */
  failCreate?: string | undefined;
  failGet?: string | undefined;
  /** Which passkey a discoverable get() picks when several exist (default: the newest). */
  pick?: 'newest' | 'oldest';
  /** An ES256 key is not offered (an authenticator that can only do RS256). */
  noEs256?: boolean;
}

const SPKI_PREFIX = Uint8Array.from(
  Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
);

function bytesOf(source: BufferSource | undefined): Uint8Array {
  if (source === undefined) throw new Error('missing buffer');
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function buffer(bytes: Bytes): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** A fake authenticator holding passkeys for one site. */
export function fakePasskeys(options: FakePasskeyOptions = {}) {
  const behaviour: FakePasskeyOptions = { pick: 'newest', ...options };
  const keys: { id: Bytes; secret: Bytes; label: string }[] = [];
  const calls = { create: 0, get: 0 };
  let counter = 0;

  const credentials: Pick<CredentialsContainer, 'create' | 'get'> = {
    async create(request) {
      calls.create++;
      if (behaviour.failCreate !== undefined) {
        throw new DOMException('no', behaviour.failCreate);
      }
      const params = request?.publicKey?.pubKeyCredParams ?? [];
      if (behaviour.noEs256 === true || !params.some((p) => p.alg === -7)) {
        throw new DOMException('no supported algorithm', 'NotSupportedError');
      }
      const secret = p256.utils.randomSecretKey();
      const id = Uint8Array.from([++counter, ...sha256(secret).slice(0, 15)]);
      keys.push({ id, secret, label: request?.publicKey?.user.name ?? '' });
      const point = p256.getPublicKey(secret, false);
      const response = {
        getPublicKey: () => buffer(Uint8Array.from([...SPKI_PREFIX, ...point])),
        getPublicKeyAlgorithm: () => -7,
      };
      return {
        id: Buffer.from(id).toString('base64url'),
        type: 'public-key',
        rawId: buffer(id),
        response,
      };
    },

    async get(request) {
      calls.get++;
      if (behaviour.failGet !== undefined) throw new DOMException('no', behaviour.failGet);
      const allowed = request?.publicKey?.allowCredentials ?? [];
      const choices =
        allowed.length === 0
          ? keys
          : keys.filter((key) => allowed.some((a) => Buffer.from(bytesOf(a.id)).equals(key.id)));
      const key = behaviour.pick === 'oldest' ? choices[0] : choices[choices.length - 1];
      if (key === undefined) throw new DOMException('no passkey', 'NotAllowedError');
      const challenge = Buffer.from(bytesOf(request?.publicKey?.challenge)).toString('base64url');
      const clientDataJSON = new TextEncoder().encode(
        `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://ge.test","crossOrigin":false}`,
      );
      const authenticatorData = Uint8Array.from([
        ...sha256(new TextEncoder().encode(request?.publicKey?.rpId ?? 'ge.test')),
        0x05,
        0,
        0,
        0,
        calls.get & 0xff,
      ]);
      const signature = p256.sign(sha256(authenticatorData, sha256(clientDataJSON)), key.secret, {
        prehash: false,
        format: 'der',
      });
      const response = {
        authenticatorData: buffer(authenticatorData),
        clientDataJSON: buffer(clientDataJSON),
        signature: buffer(signature),
      };
      return {
        id: Buffer.from(key.id).toString('base64url'),
        type: 'public-key',
        rawId: buffer(key.id),
        response,
      };
    },
  };

  return {
    env: {
      crypto: globalThis.crypto,
      credentials,
    },
    behaviour,
    calls,
    /** How many passkeys this authenticator holds. */
    count: () => keys.length,
    /** Forgets every passkey, as a phone without the synced account would. */
    wipe: () => keys.splice(0),
  };
}
