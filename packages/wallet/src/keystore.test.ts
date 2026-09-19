// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WalletError } from './errors';
import { createKeyStore } from './keystore';
import { PRF_SALT_TAG, seedFromPrf } from './passkey';
import { indexedDbStorage, type KeyStoreStorage, type StoredWallet } from './storage';
import { fakeAuthenticator, fakeEnv } from './test-helpers';

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

async function errorOf(promise: Promise<unknown>): Promise<WalletError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof WalletError))
    throw new Error(`expected a WalletError, got ${String(error)}`);
  return error;
}

function memoryStorage(): KeyStoreStorage & { peek(): StoredWallet | null } {
  let record: StoredWallet | null = null;
  return {
    load: async () => record,
    save: async (wallet) => {
      record = wallet;
    },
    clear: async () => {
      record = null;
    },
    peek: () => record,
  };
}

describe('passkey wallet', () => {
  it('uses the PRF result of the create response: one prompt, nothing secret stored', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const storage = memoryStorage();
    const store = createKeyStore({
      env: fakeEnv(auth),
      storage,
      rpId: 'clapandpay.com',
      rpName: 'Clap',
    });

    const created = await store.create();
    expect(created.kind).toBe('passkey');
    expect(created.seed).toHaveLength(32);
    expect(auth.calls.create).toHaveLength(1);
    expect(auth.calls.get).toHaveLength(0);

    const stored = storage.peek();
    expect(stored?.kind).toBe('passkey');
    expect(Object.keys(stored ?? {}).sort()).toEqual(['credentialId', 'kind']);

    const options = auth.calls.create[0]?.publicKey;
    expect(options?.rp).toEqual({ id: 'clapandpay.com', name: 'Clap' });
    expect(options?.authenticatorSelection).toEqual({
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    });
    expect(options?.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(options?.user.id.byteLength).toBe(32);
    const salt = options?.extensions?.prf?.eval?.first;
    expect(salt instanceof Uint8Array ? hexOf(salt) : null).toBe(
      createHash('sha256').update(PRF_SALT_TAG).digest('hex'),
    );
  });

  it('asks again with get when create returned no PRF result', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: false, prfEnabled: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    const created = await store.create({ prefer: 'passkey' });
    expect(created.kind).toBe('passkey');
    expect(auth.calls.get).toHaveLength(1);
    const get = auth.calls.get[0]?.publicKey;
    expect(get?.userVerification).toBe('required');
    expect(get?.allowCredentials).toHaveLength(1);
    expect(get?.rpId).toBeUndefined(); // no rpId given: the browser uses the page's domain
    expect(auth.calls.create[0]?.publicKey?.rp).toEqual({ name: 'Green Envelope' });
  });

  it('returns the same seed on every unlock, whichever call produced it first', async () => {
    for (const prfOnCreate of [true, false]) {
      const auth = fakeAuthenticator({ prfOnCreate });
      const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
      const created = await store.create();
      const first = await store.unlock();
      const second = await store.unlock();
      expect(first.kind).toBe('passkey');
      expect(hexOf(first.seed)).toBe(hexOf(created.seed));
      expect(hexOf(second.seed)).toBe(hexOf(created.seed));
    }
  });

  it('gives different passkeys different seeds', async () => {
    const auth = fakeAuthenticator();
    const env = fakeEnv(auth);
    const a = await createKeyStore({ env, storage: memoryStorage() }).create();
    const b = await createKeyStore({ env, storage: memoryStorage() }).create();
    expect(hexOf(a.seed)).not.toBe(hexOf(b.seed));
  });

  it('never uses the raw PRF output: the seed is HKDF with a domain tag', async () => {
    const env = fakeEnv(null);
    const prf = new Uint8Array(32).fill(7);
    const seed = await seedFromPrf(env, prf.slice());
    expect(hexOf(seed)).not.toBe(hexOf(prf));
    // Independent HKDF-SHA256 (RFC 5869) with node's HMAC: empty salt, one block.
    const { createHmac } = await import('node:crypto');
    const prk = createHmac('sha256', new Uint8Array(32)).update(prf).digest();
    const okm = createHmac('sha256', prk)
      .update('clapandpay:wallet:v1:seed')
      .update(Uint8Array.of(1))
      .digest();
    expect(hexOf(seed)).toBe(okm.toString('hex'));
    // The PRF buffer handed in is wiped.
    const wiped = prf.slice();
    await seedFromPrf(env, wiped);
    expect(wiped.every((b) => b === 0)).toBe(true);
  });

  it('maps a dismissed prompt to cancelled and stores nothing', async () => {
    const storage = memoryStorage();
    const auth = fakeAuthenticator({ failCreate: 'NotAllowedError' });
    const error = await errorOf(createKeyStore({ env: fakeEnv(auth), storage }).create());
    expect(error.code).toBe('cancelled');
    expect(storage.peek()).toBeNull();
  });

  it('maps a dismissed second prompt to cancelled and stores nothing', async () => {
    const storage = memoryStorage();
    const auth = fakeAuthenticator({ failGet: 'NotAllowedError' });
    const error = await errorOf(createKeyStore({ env: fakeEnv(auth), storage }).create());
    expect(error.code).toBe('cancelled');
    expect(storage.peek()).toBeNull();
  });

  it('maps a dismissed unlock prompt to cancelled and keeps the wallet', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    await store.create();
    auth.behaviour.failGet = 'NotAllowedError';
    expect((await errorOf(store.unlock())).code).toBe('cancelled');
    expect(await store.status()).toEqual({ kind: 'passkey' });
  });

  it('reports unsupported when the passkey exists but PRF does not answer on unlock', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    await store.create();
    auth.behaviour.prfOnGet = false;
    expect((await errorOf(store.unlock())).code).toBe('unsupported');
  });
});

describe('fallback to a device wallet', () => {
  it.each([
    ['PRF absent after create and get', { prfOnCreate: false, prfOnGet: false }, 1],
    ['prf.enabled = false: no second prompt', { prfOnCreate: false, prfEnabled: false }, 0],
    ['a WebAuthn stack that throws something else', { failCreate: 'NotSupportedError' }, 0],
  ])('%s', async (_, behaviour, gets) => {
    const auth = fakeAuthenticator(behaviour);
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    const created = await store.create({ prefer: 'passkey' });
    expect(created.kind).toBe('device');
    expect(auth.calls.get).toHaveLength(gets);
    expect(await store.status()).toEqual({ kind: 'device' });
    expect(hexOf((await store.unlock()).seed)).toBe(hexOf(created.seed));
  });

  it('skips WebAuthn entirely when asked for a device wallet or when unsupported', async () => {
    const auth = fakeAuthenticator();
    const preferDevice = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    expect((await preferDevice.create({ prefer: 'device' })).kind).toBe('device');
    const noPrf = createKeyStore({
      env: fakeEnv(auth, { 'extension:prf': false }),
      storage: memoryStorage(),
    });
    expect((await noPrf.create()).kind).toBe('device');
    expect(
      (await createKeyStore({ env: fakeEnv(null), storage: memoryStorage() }).create()).kind,
    ).toBe('device');
    expect(auth.calls.create).toHaveLength(0);
  });
});

describe('passkeySupported', () => {
  it('needs WebAuthn, a platform authenticator, and PRF not known to be missing', async () => {
    const auth = fakeAuthenticator();
    const supported = (env: ReturnType<typeof fakeEnv>) =>
      createKeyStore({ env, storage: memoryStorage() }).passkeySupported();

    expect(await supported(fakeEnv(null))).toBe(false);
    expect(await supported(fakeEnv(auth))).toBe(true); // capabilities unknown: try and see
    expect(await supported(fakeEnv(auth, { 'extension:prf': true }))).toBe(true);
    expect(await supported(fakeEnv(auth, { 'extension:prf': false }))).toBe(false);
    expect(await supported(fakeEnv(auth, { conditionalGet: true }))).toBe(true);

    const noPlatform = fakeEnv(auth);
    noPlatform.publicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
    };
    expect(await supported(noPlatform)).toBe(false);

    const throwing = fakeEnv(auth);
    throwing.publicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.reject(new Error('blocked')),
    };
    expect(await supported(throwing)).toBe(false);
    expect(auth.calls.create).toHaveLength(0);
    expect(auth.calls.get).toHaveLength(0);
  });
});

describe('device wallet on IndexedDB', () => {
  it('stores a non-extractable key and ciphertext, never the seed; unlock is stable', async () => {
    const env = fakeEnv(null);
    const store = createKeyStore({ env });
    const created = await store.create();
    expect(created).toMatchObject({ kind: 'device' });
    expect(created.seed).toHaveLength(32);

    const stored = await indexedDbStorage(env.indexedDB).load();
    if (stored?.kind !== 'device') throw new Error('expected a device record');
    expect(stored.key.extractable).toBe(false);
    expect(stored.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(stored.iv).toHaveLength(12);
    expect(stored.ciphertext).toHaveLength(32 + 16);
    expect(hexOf(stored.ciphertext)).not.toContain(hexOf(created.seed));
    await expect(env.crypto.subtle.exportKey('raw', stored.key)).rejects.toThrow();

    // A second keystore over the same database is "the next page load".
    const again = createKeyStore({ env });
    expect(await again.status()).toEqual({ kind: 'device' });
    expect(hexOf((await again.unlock()).seed)).toBe(hexOf(created.seed));
    expect(hexOf((await again.unlock()).seed)).toBe(hexOf(created.seed));
  });

  it('gives every device wallet its own seed', async () => {
    const a = await createKeyStore({ env: fakeEnv(null) }).create();
    const b = await createKeyStore({ env: fakeEnv(null) }).create();
    expect(hexOf(a.seed)).not.toBe(hexOf(b.seed));
  });

  it('reports corrupt when the ciphertext was tampered with or the record is unknown', async () => {
    const env = fakeEnv(null);
    const store = createKeyStore({ env });
    await store.create();
    const storage = indexedDbStorage(env.indexedDB);
    const stored = await storage.load();
    if (stored?.kind !== 'device') throw new Error('expected a device record');
    stored.ciphertext[0] = (stored.ciphertext[0] ?? 0) ^ 1;
    await storage.save(stored);
    expect((await errorOf(store.unlock())).code).toBe('corrupt');

    await storage.save(JSON.parse('{"kind":"paper"}'));
    expect((await errorOf(store.status())).code).toBe('corrupt');
  });

  it('reports storage when IndexedDB is missing or fails', async () => {
    const env = fakeEnv(null);
    env.indexedDB = undefined;
    expect((await errorOf(createKeyStore({ env }).status())).code).toBe('storage');

    const broken = fakeEnv(null);
    broken.indexedDB = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const error = await errorOf(createKeyStore({ env: broken }).create());
    expect(error.code).toBe('storage');
    expect(error.message).toContain('denied');
  });
});

describe('status, forget, create twice', () => {
  it('status never prompts and is null before create and after forget', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const env = fakeEnv(auth);
    const store = createKeyStore({ env });
    expect(await store.status()).toBeNull();
    await store.create();
    const prompts = auth.calls.create.length + auth.calls.get.length;
    expect(await store.status()).toEqual({ kind: 'passkey' });
    expect(await createKeyStore({ env }).status()).toEqual({ kind: 'passkey' });
    expect(auth.calls.create.length + auth.calls.get.length).toBe(prompts);

    await store.forget();
    expect(await store.status()).toBeNull();
    expect((await errorOf(store.unlock())).code).toBe('no_wallet');
    await store.forget(); // idempotent
  });

  it('forgets a device wallet', async () => {
    const store = createKeyStore({ env: fakeEnv(null) });
    await store.create();
    await store.forget();
    expect(await store.status()).toBeNull();
  });

  it('refuses to create over an existing wallet, so a seed is never overwritten', async () => {
    const auth = fakeAuthenticator();
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    const first = await store.create({ prefer: 'device' });
    expect((await errorOf(store.create())).code).toBe('exists');
    expect(auth.calls.create).toHaveLength(0);
    expect(hexOf((await store.unlock()).seed)).toBe(hexOf(first.seed));
  });

  it('reads the browser globals lazily when no env is given', async () => {
    vi.stubGlobal('indexedDB', fakeEnv(null).indexedDB);
    try {
      const store = createKeyStore();
      expect(await store.passkeySupported()).toBe(false); // node has no PublicKeyCredential
      const created = await store.create();
      expect(created.kind).toBe('device');
      expect(hexOf((await store.unlock()).seed)).toBe(hexOf(created.seed));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
