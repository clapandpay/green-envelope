// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WalletError } from './errors';
import { createKeyStore } from './keystore';
import { keysFromPrf, PRF_SALT_TAG, seedFromPrf } from './passkey';
import {
  indexedDbStorage,
  type KeyStoreStorage,
  parseStoredWallet,
  type StoredWallet,
} from './storage';
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
    expect(created.version).toBe(2);
    expect(created.entropy).toHaveLength(32); // the 24 words
    expect(created.seed).toHaveLength(64); // their BIP-39 seed
    expect(auth.calls.create).toHaveLength(1);
    expect(auth.calls.get).toHaveLength(0);

    const stored = storage.peek();
    expect(stored?.kind).toBe('passkey');
    expect(Object.keys(stored ?? {}).sort()).toEqual(['credentialId', 'kind', 'version']);

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
    expect(await store.status()).toMatchObject({ kind: 'passkey', restorable: true });
  });

  it('reports unsupported when the passkey exists but PRF does not answer on unlock', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    await store.create();
    auth.behaviour.prfOnGet = false;
    expect((await errorOf(store.unlock())).code).toBe('unsupported');
  });
});

describe('no silent device wallet (audit M2)', () => {
  it.each([
    ['PRF absent after create and get', { prfOnCreate: false, prfOnGet: false }, 1],
    ['prf.enabled = false: no second prompt', { prfOnCreate: false, prfEnabled: false }, 0],
    ['a WebAuthn stack that throws something else', { failCreate: 'NotSupportedError' }, 0],
  ])('%s: unsupported, nothing stored', async (_, behaviour, gets) => {
    const auth = fakeAuthenticator(behaviour);
    const storage = memoryStorage();
    const store = createKeyStore({ env: fakeEnv(auth), storage });
    expect((await errorOf(store.create({ prefer: 'passkey' }))).code).toBe('unsupported');
    expect(auth.calls.get).toHaveLength(gets);
    expect(storage.peek()).toBeNull();
  });

  it('refuses without WebAuthn or PRF, and makes a device wallet only when asked', async () => {
    const auth = fakeAuthenticator();
    const noPrf = createKeyStore({
      env: fakeEnv(auth, { 'extension:prf': false }),
      storage: memoryStorage(),
    });
    expect((await errorOf(noPrf.create())).code).toBe('unsupported');
    const noWebAuthn = createKeyStore({ env: fakeEnv(null), storage: memoryStorage() });
    expect((await errorOf(noWebAuthn.create())).code).toBe('unsupported');
    expect(auth.calls.create).toHaveLength(0);

    const asked = await noWebAuthn.create({ prefer: 'device' });
    expect(asked).toMatchObject({ kind: 'device', version: 2 });
    expect(asked.entropy).toHaveLength(32);
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

    // A Mac with no Touch ID still has passkeys, in 1Password or Apple Passwords. The built-in
    // sensor is not the question, so its absence is not an answer.
    const noPlatform = fakeEnv(auth, undefined, false);
    expect(await supported(noPlatform)).toBe(true);

    const throwing = fakeEnv(auth);
    throwing.publicKeyCredential = {
      getClientCapabilities: () => Promise.reject(new Error('blocked')),
    };
    expect(await supported(throwing)).toBe(false);
    expect(auth.calls.create).toHaveLength(0);
    expect(auth.calls.get).toHaveLength(0);
  });

  it('never asks for the built-in sensor, so a password manager can answer', async () => {
    // `authenticatorAttachment: 'platform'` would shut out 1Password, Apple Passwords and every
    // security key. It has never been set here, and this test is what keeps it that way.
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({
      env: fakeEnv(auth, undefined, false),
      storage: memoryStorage(),
    });

    const created = await store.create();

    expect(created.kind).toBe('passkey');
    const selection = auth.calls.create[0]?.publicKey?.authenticatorSelection;
    expect(selection).not.toHaveProperty('authenticatorAttachment');
    expect(selection?.residentKey).toBe('required'); // discoverable: found again on a new device
  });
});

describe('device wallet on IndexedDB', () => {
  it('stores a non-extractable key and ciphertext, never the seed; unlock is stable', async () => {
    const env = fakeEnv(null);
    const store = createKeyStore({ env });
    const created = await store.create({ prefer: 'device' });
    expect(created).toMatchObject({ kind: 'device', version: 2 });
    expect(created.seed).toHaveLength(64);
    const entropy = created.entropy ?? new Uint8Array();
    expect(entropy).toHaveLength(32);

    const stored = await indexedDbStorage(env.indexedDB).load();
    if (stored?.kind !== 'device') throw new Error('expected a device record');
    expect(stored.key.extractable).toBe(false);
    expect(stored.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(stored.iv).toHaveLength(12);
    expect(stored.ciphertext).toHaveLength(32 + 16);
    expect(stored.version).toBe(2);
    expect(hexOf(stored.ciphertext)).not.toContain(hexOf(entropy));
    await expect(env.crypto.subtle.exportKey('raw', stored.key)).rejects.toThrow();

    // A second keystore over the same database is "the next page load".
    const again = createKeyStore({ env });
    expect(await again.status()).toMatchObject({ kind: 'device', restorable: false });
    expect(hexOf((await again.unlock()).seed)).toBe(hexOf(created.seed));
    expect(hexOf((await again.unlock()).seed)).toBe(hexOf(created.seed));
  });

  it('gives every device wallet its own seed', async () => {
    const a = await createKeyStore({ env: fakeEnv(null) }).create({ prefer: 'device' });
    const b = await createKeyStore({ env: fakeEnv(null) }).create({ prefer: 'device' });
    expect(hexOf(a.seed)).not.toBe(hexOf(b.seed));
  });

  it('reports corrupt when the ciphertext was tampered with or the record is unknown', async () => {
    const env = fakeEnv(null);
    const store = createKeyStore({ env });
    await store.create({ prefer: 'device' });
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
    expect(await store.status()).toMatchObject({ kind: 'passkey', restorable: true });
    expect(await createKeyStore({ env }).status()).toMatchObject({
      kind: 'passkey',
      restorable: true,
    });
    expect(auth.calls.create.length + auth.calls.get.length).toBe(prompts);

    await store.forget();
    expect(await store.status()).toBeNull();
    expect((await errorOf(store.unlock())).code).toBe('no_wallet');
    await store.forget(); // idempotent
  });

  it('forgets a device wallet', async () => {
    const store = createKeyStore({ env: fakeEnv(null) });
    await store.create({ prefer: 'device' });
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
      const created = await store.create({ prefer: 'device' });
      expect(created.kind).toBe('device');
      expect(hexOf((await store.unlock()).seed)).toBe(hexOf(created.seed));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('signIn: a wallet made somewhere else', () => {
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

  it('finds the same wallet in another browser on the same phone, without creating anything', async () => {
    const phone = fakeAuthenticator();
    const chat = createKeyStore({ env: fakeEnv(phone), storage: memoryStorage() });
    const made = await chat.create();
    expect(made.kind).toBe('passkey');
    const seed = hex(made.seed);

    // Another browser: same authenticator, empty storage.
    const safari = createKeyStore({ env: fakeEnv(phone), storage: memoryStorage() });
    expect(await safari.status()).toBeNull();
    const found = await safari.signIn();
    expect(hex(found.seed)).toBe(seed);
    expect(phone.calls.create).toHaveLength(1);
    expect(phone.calls.get.at(-1)?.publicKey?.allowCredentials).toEqual([]);

    // Remembered: from now on it is an ordinary unlock of that passkey.
    expect(await safari.status()).toMatchObject({ kind: 'passkey', restorable: true });
    expect(hex((await safari.unlock()).seed)).toBe(seed);
    expect(phone.calls.get.at(-1)?.publicKey?.allowCredentials).toHaveLength(1);
  });

  it('is an unlock when this browser already has a wallet, and never replaces a device wallet', async () => {
    const store = createKeyStore({ env: fakeEnv(null), storage: memoryStorage() });
    const device = await store.create({ prefer: 'device' });
    expect(device.kind).toBe('device');
    const again = await store.signIn();
    expect(again.kind).toBe('device');
    expect(hex(again.seed)).toBe(hex(device.seed));
  });

  it('says no_wallet when the phone has no passkey for this site', async () => {
    const store = createKeyStore({ env: fakeEnv(fakeAuthenticator()), storage: memoryStorage() });
    await expect(store.signIn()).rejects.toMatchObject({ code: 'cancelled' });
    const without = createKeyStore({ env: fakeEnv(null), storage: memoryStorage() });
    await expect(without.signIn()).rejects.toMatchObject({ code: 'no_wallet' });
    expect(await without.status()).toBeNull();
  });

  it('does not remember a passkey that cannot evaluate PRF here', async () => {
    const phone = fakeAuthenticator();
    await createKeyStore({ env: fakeEnv(phone), storage: memoryStorage() }).create();
    phone.behaviour.prfOnGet = false;
    const other = createKeyStore({ env: fakeEnv(phone), storage: memoryStorage() });
    await expect(other.signIn()).rejects.toMatchObject({ code: 'unsupported' });
    expect(await other.status()).toBeNull();
  });
});

describe('a wallet brought from somewhere else, kept behind a passkey', () => {
  const IMPORTED = new Uint8Array(32).fill(9);

  function store(auth: ReturnType<typeof fakeAuthenticator>, storage = memoryStorage()) {
    return {
      store: createKeyStore({ env: fakeEnv(auth), storage, rpName: 'Clap' }),
      storage,
    };
  }

  it('keeps the imported seed, not the one the passkey would have derived', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const { store: keyStore, storage } = store(auth);

    const imported = await keyStore.importWallet(IMPORTED);
    expect(imported.kind).toBe('passkey');
    expect(hexOf(imported.seed)).toBe(hexOf(IMPORTED));

    // The passkey's own derived seed is a different value, and is not what came back.
    const derived = await createKeyStore({
      env: fakeEnv(fakeAuthenticator({ prfOnCreate: true })),
      storage: memoryStorage(),
      rpName: 'Clap',
    }).create();
    expect(hexOf(derived.seed)).not.toBe(hexOf(IMPORTED));

    // What is stored is a ciphertext, never the seed itself.
    const record = storage.peek();
    expect(record?.kind).toBe('wrapped');
    const stored = record as Extract<typeof record, { kind: 'wrapped' }>;
    expect(hexOf(stored.ciphertext)).not.toContain(hexOf(IMPORTED));
    expect(Object.keys(stored).sort()).toEqual([
      'ciphertext',
      'credentialId',
      'iv',
      'kind',
      'version',
    ]);
    expect(stored.version).toBe(1); // a seed from elsewhere has no words
  });

  it('gives the same seed back on unlock, and calls itself a passkey wallet', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const { store: keyStore } = store(auth);

    await keyStore.importWallet(IMPORTED);
    expect(await keyStore.status()).toMatchObject({ kind: 'passkey', restorable: false });

    const opened = await keyStore.unlock();
    expect(opened.kind).toBe('passkey');
    expect(hexOf(opened.seed)).toBe(hexOf(IMPORTED));
  });

  it('refuses to import over a wallet that is already here', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const { store: keyStore } = store(auth);
    await keyStore.create();

    expect((await errorOf(keyStore.importWallet(IMPORTED))).code).toBe('exists');
  });

  it('refuses a seed that is not a seed', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const { store: keyStore } = store(auth);
    await expect(keyStore.importWallet(new Uint8Array(16))).rejects.toBeInstanceOf(RangeError);
  });

  it('refuses a record that has been altered, rather than returning nonsense', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const { store: keyStore, storage } = store(auth);
    await keyStore.importWallet(IMPORTED);

    // AES-GCM authenticates what it encrypts, so a changed byte is caught, not decrypted into
    // a different seed that would quietly become a different wallet.
    const record = storage.peek() as Extract<StoredWallet, { kind: 'wrapped' }>;
    const ciphertext = new Uint8Array(record.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await storage.save({ ...record, ciphertext });

    expect((await errorOf(keyStore.unlock())).code).toBe('corrupt');
  });

  it('is not found by signing in on another device: the wrapped seed is only here', async () => {
    // A derived passkey wallet reappears wherever the passkey syncs. An imported one cannot:
    // the passkey unwraps the seed, but the wrapped seed lives in this browser's storage.
    const auth = fakeAuthenticator({ prfOnCreate: true });
    await createKeyStore({
      env: fakeEnv(auth),
      storage: memoryStorage(),
      rpName: 'Clap',
    }).importWallet(IMPORTED);

    const otherDevice = createKeyStore({
      env: fakeEnv(auth),
      storage: memoryStorage(), // same passkey, empty local storage
      rpName: 'Clap',
    });
    const found = await otherDevice.signIn();
    expect(hexOf(found.seed)).not.toBe(hexOf(IMPORTED));
  });
});

describe('the two keys one passkey yields', () => {
  it('are independent: the wrapping key tells you nothing about the seed', async () => {
    const env = fakeEnv(null);
    const prf = new Uint8Array(32).fill(3);

    const first = await keysFromPrf(env, prf.slice());
    const second = await keysFromPrf(env, prf.slice());

    // Same passkey, same seed every time: that is what makes a derived wallet reappear.
    expect(hexOf(first.seed)).toBe(hexOf(second.seed));
    // And the wrapping key is a key, not bytes anyone can read.
    expect(first.wrapKey.extractable).toBe(false);
    expect(first.wrapKey.algorithm).toMatchObject({ name: 'AES-GCM' });
    await expect(crypto.subtle.exportKey('raw', first.wrapKey)).rejects.toBeTruthy();
  });

  it('wipes the PRF output it was given', async () => {
    const env = fakeEnv(null);
    const prf = new Uint8Array(32).fill(5);
    await keysFromPrf(env, prf);
    expect(prf.every((byte) => byte === 0)).toBe(true);
  });

  it('still derives the same seed as seedFromPrf did before', async () => {
    const env = fakeEnv(null);
    const prf = new Uint8Array(32).fill(1);
    const viaSeed = await seedFromPrf(env, prf.slice());
    const viaKeys = await keysFromPrf(env, prf.slice());
    expect(hexOf(viaSeed)).toBe(hexOf(viaKeys.seed));
  });
});

describe('putting a device wallet behind a passkey', () => {
  it('keeps the same seed, so the address and the money do not change', async () => {
    const storage = memoryStorage();
    const before = await createKeyStore({ env: fakeEnv(null), storage }).create({
      prefer: 'device',
    });
    expect(before.kind).toBe('device');

    const auth = fakeAuthenticator({ prfOnCreate: true });
    const after = await createKeyStore({
      env: fakeEnv(auth),
      storage,
      rpName: 'Clap',
    }).secureWithPasskey();

    expect(after.kind).toBe('passkey');
    // The whole point: a new lock on the same door. A different seed would be a different
    // wallet, and the money would be somewhere the person can no longer reach.
    expect(hexOf(after.seed)).toBe(hexOf(before.seed));
    expect(storage.peek()?.kind).toBe('wrapped');
  });

  it('opens with the passkey afterwards, and still gives that seed', async () => {
    const storage = memoryStorage();
    const before = await createKeyStore({ env: fakeEnv(null), storage }).create({
      prefer: 'device',
    });
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage, rpName: 'Clap' });
    await store.secureWithPasskey();

    expect(await store.status()).toMatchObject({ kind: 'passkey', restorable: false });
    expect(hexOf((await store.unlock()).seed)).toBe(hexOf(before.seed));
  });

  it('leaves the wallet untouched when the prompt is dismissed', async () => {
    const storage = memoryStorage();
    const before = await createKeyStore({ env: fakeEnv(null), storage }).create({
      prefer: 'device',
    });
    // NotAllowedError is what a browser gives when the person dismisses the sheet.
    const refusing = fakeAuthenticator({ failCreate: 'NotAllowedError' });
    const store = createKeyStore({ env: fakeEnv(refusing), storage, rpName: 'Clap' });

    expect((await errorOf(store.secureWithPasskey())).code).toBe('cancelled');

    // Nothing was written, so the money is still reachable exactly as before.
    expect(storage.peek()?.kind).toBe('device');
    const still = await createKeyStore({ env: fakeEnv(null), storage }).unlock();
    expect(hexOf(still.seed)).toBe(hexOf(before.seed));
  });

  it('refuses a wallet that is already behind a passkey, and one that is not there', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const storage = memoryStorage();
    const store = createKeyStore({ env: fakeEnv(auth), storage, rpName: 'Clap' });

    expect((await errorOf(store.secureWithPasskey())).code).toBe('no_wallet');
    await store.create();
    expect((await errorOf(store.secureWithPasskey())).code).toBe('exists');
  });
});

describe('a second passkey wallet', () => {
  it('replaces a derived passkey wallet only after the new passkey exists', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const storage = memoryStorage();
    const store = createKeyStore({ env: fakeEnv(auth), storage });
    const first = await store.create();

    auth.behaviour.failCreate = 'NotAllowedError';
    expect((await errorOf(store.create({ replace: true }))).code).toBe('cancelled');
    expect(hexOf((await store.unlock()).seed)).toBe(hexOf(first.seed)); // still the first

    delete auth.behaviour.failCreate;
    const second = await store.create({ replace: true });
    expect(hexOf(second.seed)).not.toBe(hexOf(first.seed));
    expect(hexOf((await store.unlock()).seed)).toBe(hexOf(second.seed));
  });

  it('never replaces a wallet that lives only here', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const store = createKeyStore({ env: fakeEnv(auth), storage: memoryStorage() });
    await store.create({ prefer: 'device' });
    expect((await errorOf(store.create({ replace: true }))).code).toBe('exists');
    expect(auth.calls.create).toHaveLength(0);
  });
});

describe('the relying party is named in every call (TASK-127)', () => {
  it('asks for clapandpay.com in create, unlock and sign-in', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const env = fakeEnv(auth);
    const store = createKeyStore({ env, storage: memoryStorage(), rpId: 'clapandpay.com' });
    await store.create();
    await store.unlock();
    await createKeyStore({ env, storage: memoryStorage(), rpId: 'clapandpay.com' }).signIn();

    expect(auth.calls.create[0]?.publicKey?.rp.id).toBe('clapandpay.com');
    expect(auth.calls.get.map((call) => call.publicKey?.rpId)).toEqual([
      'clapandpay.com',
      'clapandpay.com',
    ]);
  });
});

describe('audit fixes (TASK-127 audit)', () => {
  it('writes a version 2 record so code from before versions refuses it (L-1)', async () => {
    const env = fakeEnv(fakeAuthenticator({ prfOnCreate: true }));
    await createKeyStore({ env }).create();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const open = env.indexedDB?.open('ge-wallet', 1);
      if (open === undefined) throw new Error('no IndexedDB');
      open.onsuccess = () => {
        const get = open.result.transaction('keystore').objectStore('keystore').get('wallet');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
    // The old parser compares kind with 'passkey' | 'device' | 'wrapped' and throws otherwise.
    expect((raw as { kind: string }).kind).toBe('passkey:v2');
    expect(raw).not.toHaveProperty('version');
    expect(parseStoredWallet(raw)?.version).toBe(2);
  });

  it('refuses a record with a version field or an unknown version', () => {
    const credentialId = new Uint8Array(8);
    expect(() => parseStoredWallet({ kind: 'passkey', version: 3, credentialId })).toThrow(
      WalletError,
    );
    expect(() => parseStoredWallet({ kind: 'passkey:v3', credentialId })).toThrow(WalletError);
    expect(parseStoredWallet({ kind: 'passkey', credentialId })?.version).toBe(1);
  });

  it('never replaces a version 1 passkey wallet: sign-in would not bring its money back (M-1)', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const storage = memoryStorage();
    await storage.save({ kind: 'passkey', version: 1, credentialId: new Uint8Array(8) });
    const store = createKeyStore({ env: fakeEnv(auth), storage });
    expect((await errorOf(store.create({ replace: true }))).code).toBe('exists');
    expect(auth.calls.create).toHaveLength(0);
  });

  it('does not overwrite a wallet another tab made during the prompt (L-2)', async () => {
    const auth = fakeAuthenticator({ prfOnCreate: true });
    const storage = memoryStorage();
    const otherTab = createKeyStore({ env: fakeEnv(null), storage });
    const store = createKeyStore({ env: fakeEnv(auth), storage });
    // The other tab makes a device wallet while this tab's create sheet is open.
    const real = auth.credentials.create.bind(auth.credentials);
    auth.credentials.create = async (options) => {
      await otherTab.create({ prefer: 'device' });
      return real(options);
    };
    expect((await errorOf(store.create())).code).toBe('exists');
    expect(storage.peek()?.kind).toBe('device');
  });
});
