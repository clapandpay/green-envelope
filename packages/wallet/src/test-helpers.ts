// SPDX-License-Identifier: AGPL-3.0-or-later
// A fake authenticator and environment for the keystore tests.
import { createHmac, randomBytes } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { KeyStoreEnv } from './env';

/** How the fake authenticator behaves. */
export interface FakeAuthenticatorOptions {
  prfOnCreate?: boolean; // PRF results already in the create() response
  prfOnGet?: boolean; // PRF results in get() responses
  prfEnabled?: boolean | undefined; // the `enabled` flag of the create() response
  failCreate?: string; // DOMException name thrown by create()
  failGet?: string; // DOMException name thrown by get()
}

function bytesOf(source: BufferSource | undefined): Uint8Array {
  if (source === undefined) throw new Error('missing buffer');
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

/** A fake `navigator.credentials` whose passkeys compute PRF as HMAC(credential secret, salt). */
export function fakeAuthenticator(options: FakeAuthenticatorOptions = {}) {
  const behaviour = { prfOnCreate: false, prfOnGet: true, ...options };
  const secrets = new Map<string, Buffer>();
  const calls: { create: CredentialCreationOptions[]; get: CredentialRequestOptions[] } = {
    create: [],
    get: [],
  };

  function credential(
    id: Uint8Array<ArrayBuffer>,
    prf: AuthenticationExtensionsPRFOutputs,
  ): Credential {
    const made = {
      id: Buffer.from(id).toString('base64url'),
      type: 'public-key',
      rawId: id.buffer,
      getClientExtensionResults: (): AuthenticationExtensionsClientOutputs => ({ prf }),
    };
    return made;
  }

  function evaluate(id: Uint8Array, salt: BufferSource | undefined): ArrayBuffer {
    const secret = secrets.get(Buffer.from(id).toString('hex'));
    if (secret === undefined) throw new DOMException('unknown credential', 'NotAllowedError');
    const mac = createHmac('sha256', secret).update(bytesOf(salt)).digest();
    return new Uint8Array(mac).buffer;
  }

  const credentials: Pick<CredentialsContainer, 'create' | 'get'> = {
    async create(request) {
      calls.create.push(request ?? {});
      if (behaviour.failCreate !== undefined) throw new DOMException('no', behaviour.failCreate);
      const id = new Uint8Array(randomBytes(20));
      secrets.set(Buffer.from(id).toString('hex'), randomBytes(32));
      const salt = request?.publicKey?.extensions?.prf?.eval?.first;
      const prf: AuthenticationExtensionsPRFOutputs = {};
      if (behaviour.prfEnabled !== undefined) prf.enabled = behaviour.prfEnabled;
      if (behaviour.prfOnCreate) prf.results = { first: evaluate(id, salt) };
      return credential(id, prf);
    },
    async get(request) {
      calls.get.push(request ?? {});
      if (behaviour.failGet !== undefined) throw new DOMException('no', behaviour.failGet);
      const allowed = request?.publicKey?.allowCredentials?.[0]?.id;
      const id = new Uint8Array(bytesOf(allowed));
      const salt = request?.publicKey?.extensions?.prf?.eval?.first;
      return credential(id, behaviour.prfOnGet ? { results: { first: evaluate(id, salt) } } : {});
    },
  };
  return { credentials, calls, behaviour };
}

/** A node environment with WebCrypto, a fresh fake IndexedDB and the given authenticator. */
export function fakeEnv(
  authenticator: { credentials: Pick<CredentialsContainer, 'create' | 'get'> } | null,
  capabilities?: Record<string, boolean>,
): KeyStoreEnv {
  const env: KeyStoreEnv = { crypto: globalThis.crypto, indexedDB: new IDBFactory() };
  if (authenticator !== null) {
    env.credentials = authenticator.credentials;
    env.publicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      ...(capabilities === undefined ? {} : { getClientCapabilities: async () => capabilities }),
    };
  }
  return env;
}
