// SPDX-License-Identifier: AGPL-3.0-or-later
import { createDeviceWallet, SEED_BYTES, unlockDeviceWallet } from './device';
import { browserEnv, type KeyStoreEnv } from './env';
import { WalletError } from './errors';
import {
  createPasskeyWallet,
  findPasskeyWallet,
  type RelyingParty,
  unlockPasskeyWallet,
} from './passkey';
import { indexedDbStorage, type KeyStoreStorage, type StoredWallet } from './storage';

/** How the wallet's seed is protected. */
export type WalletKind = 'passkey' | 'device';

/** An unlocked wallet: its kind and its 32-byte seed. */
export interface UnlockedWallet {
  kind: WalletKind;
  seed: Uint8Array;
}

/** Creates, unlocks and forgets the one wallet of this browser profile. */
export interface KeyStore {
  /**
   * What exists on this device, without prompting the user.
   *
   * `restorable` is whether this wallet would come back if the record here were removed. Only
   * a seed the passkey derives can: a device wallet's seed and an imported wallet's wrapped
   * seed both live in this browser and nowhere else, so forgetting either loses the money.
   */
  status(): Promise<{ kind: WalletKind; restorable: boolean } | null>;
  /** WebAuthn with a user-verifying platform authenticator, and PRF not known to be missing. */
  passkeySupported(): Promise<boolean>;
  /** Creates a wallet and returns its 32-byte seed. Prefers passkey when `prefer` allows and it is supported. */
  create(opts?: { prefer?: WalletKind }): Promise<UnlockedWallet>;
  /** Returns the seed of the existing wallet (passkey: prompts biometrics). */
  unlock(): Promise<UnlockedWallet>;
  /**
   * Puts the wallet already on this device behind a passkey, keeping its seed. The address and
   * the money do not change: this is a new lock on the same door, not a move to a new one.
   *
   * Nothing is written until the passkey exists and the seed is wrapped, so a dismissed prompt
   * leaves the wallet exactly as it was.
   */
  secureWithPasskey(): Promise<UnlockedWallet>;
  /**
   * Puts a seed that came from somewhere else behind a new passkey: an existing wallet a person
   * is bringing with them, or a device wallet being secured. Refuses when a wallet already
   * exists here — `forget()` first, after moving the money.
   *
   * Unlike a wallet this passkey derived, an imported one does not reappear on another device
   * when the passkey syncs there: the passkey unwraps the seed, but the wrapped seed itself
   * lives in this browser's storage and nowhere else. `signIn()` on a new phone will not find
   * it.
   */
  importWallet(seed: Uint8Array): Promise<UnlockedWallet>;
  /**
   * Finds a passkey wallet that was made somewhere else (another browser, another phone) and
   * remembers it here. Never creates one. With a wallet already on this device it is `unlock()`.
   */
  signIn(): Promise<UnlockedWallet>;
  /** Removes the local record. A device wallet's money is lost with it; a passkey stays in the user's account. */
  forget(): Promise<void>;
}

/** Options of `createKeyStore`. `env` is for tests; everything defaults to the browser. */
export interface KeyStoreOptions {
  rpId?: string;
  rpName?: string;
  storage?: KeyStoreStorage;
  env?: KeyStoreEnv;
}

const IV_BYTES = 12;

type WrappedRecord = Extract<StoredWallet, { kind: 'wrapped' }>;

/** Encrypts an imported seed under the passkey's wrapping key. */
async function wrapSeed(
  env: KeyStoreEnv,
  wrapKey: CryptoKey,
  credentialId: Uint8Array<ArrayBuffer>,
  seed: Uint8Array,
): Promise<WrappedRecord> {
  const iv = env.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // An ArrayBuffer-backed copy: WebCrypto wants one, and the caller's array may be a view on
  // something else. Wiped again below, so the seed exists here for no longer than the encrypt.
  const owned = new Uint8Array(seed);
  try {
    const ciphertext = new Uint8Array(
      await env.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, owned),
    );
    return { kind: 'wrapped', credentialId, iv, ciphertext };
  } finally {
    owned.fill(0);
  }
}

/** Decrypts it again. Any failure means the record cannot be used, not that there is no wallet. */
async function unwrapSeed(
  env: KeyStoreEnv,
  wrapKey: CryptoKey,
  record: WrappedRecord,
): Promise<Uint8Array<ArrayBuffer>> {
  let seed: Uint8Array<ArrayBuffer>;
  try {
    const plain = await env.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      wrapKey,
      record.ciphertext,
    );
    seed = new Uint8Array(plain);
  } catch (cause) {
    // AES-GCM authenticates: this is a changed record, or a different passkey than the one
    // that wrapped it. Either way the seed is not recoverable here.
    throw new WalletError('corrupt', 'the wrapped wallet cannot be decrypted', { cause });
  }
  if (seed.length !== SEED_BYTES) {
    throw new WalletError('corrupt', 'the stored seed has a wrong length');
  }
  return seed;
}

/** Creates the keystore. Nothing is touched until a method is called. */
export function createKeyStore(opts: KeyStoreOptions = {}): KeyStore {
  const env = (): KeyStoreEnv => opts.env ?? browserEnv();
  const rp: RelyingParty = { rpId: opts.rpId, rpName: opts.rpName ?? 'Green Envelope' };
  let defaultStorage: KeyStoreStorage | undefined;
  const storage = (): KeyStoreStorage => {
    if (opts.storage !== undefined) return opts.storage;
    defaultStorage ??= indexedDbStorage(env().indexedDB);
    return defaultStorage;
  };

  /**
   * Whether it is worth offering a passkey here.
   *
   * The only clear no is a client that says it cannot evaluate PRF: a passkey there could never
   * hold a wallet. Everything else is a yes, including a Mac with no Touch ID.
   * `isUserVerifyingPlatformAuthenticatorAvailable` reports the built-in sensor and nothing
   * else, so answering it with "no passkeys then" quietly hands the weaker device wallet to
   * everyone whose passkeys live in 1Password, Apple Passwords or a security key. Offer it,
   * and let `create()` fall back only when the authenticator really cannot do it.
   */
  async function passkeySupported(): Promise<boolean> {
    const { credentials, publicKeyCredential: pkc } = env();
    if (credentials === undefined) return false;
    try {
      return (await pkc?.getClientCapabilities?.())?.['extension:prf'] !== false;
    } catch {
      return false;
    }
  }

  async function createDevice(): Promise<UnlockedWallet> {
    const { seed, record } = await createDeviceWallet(env());
    await storage().save(record);
    return { kind: 'device', seed };
  }

  return {
    async status() {
      const stored = await storage().load();
      if (stored === null) return null;
      // 'wrapped' is a storage detail: it opens with the passkey, so that is the kind. It is
      // not restorable, though, because the wrapped seed is here and only here.
      return {
        kind: stored.kind === 'device' ? 'device' : 'passkey',
        restorable: stored.kind === 'passkey',
      };
    },

    passkeySupported,

    async create(createOpts) {
      if ((await storage().load()) !== null) {
        throw new WalletError('exists', 'a wallet already exists on this device');
      }
      if (createOpts?.prefer === 'device' || !(await passkeySupported())) return createDevice();
      let made: Awaited<ReturnType<typeof createPasskeyWallet>>;
      try {
        made = await createPasskeyWallet(env(), rp);
      } catch (error) {
        if (error instanceof WalletError) throw error; // cancelled: the user decides what is next
        return createDevice(); // a broken WebAuthn stack must never block a claim
      }
      if (made.seed === null || made.credentialId === null) return createDevice(); // no PRF here
      await storage().save({ kind: 'passkey', credentialId: made.credentialId });
      return { kind: 'passkey', seed: made.seed };
    },

    async unlock() {
      const stored = await storage().load();
      if (stored === null) throw new WalletError('no_wallet', 'create a wallet first');
      if (stored.kind === 'device') {
        return { kind: 'device', seed: await unlockDeviceWallet(env(), stored) };
      }
      if (stored.kind === 'wrapped') {
        const opened = await unlockPasskeyWallet(env(), rp, stored.credentialId);
        // This wallet's seed is the wrapped one; the seed the passkey derives is not wanted
        // here and does not get to linger on the heap.
        opened.seed?.fill(0);
        const { wrapKey } = opened;
        if (wrapKey === null) {
          throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
        }
        return { kind: 'passkey', seed: await unwrapSeed(env(), wrapKey, stored) };
      }
      const { seed } = await unlockPasskeyWallet(env(), rp, stored.credentialId);
      if (seed === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      return { kind: 'passkey', seed };
    },

    async secureWithPasskey() {
      const stored = await storage().load();
      if (stored === null) throw new WalletError('no_wallet', 'create a wallet first');
      if (stored.kind !== 'device') {
        throw new WalletError('exists', 'this wallet is already behind a passkey');
      }
      if (!(await passkeySupported())) {
        throw new WalletError('unsupported', 'no passkey can be made here');
      }
      const seed = await unlockDeviceWallet(env(), stored);
      try {
        const made = await createPasskeyWallet(env(), rp);
        made.seed?.fill(0); // the passkey's own seed is not this wallet's seed
        if (made.credentialId === null || made.wrapKey === null) {
          throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
        }
        const record = await wrapSeed(env(), made.wrapKey, made.credentialId, seed);
        // Only now: until this line the device wallet is still the record, so a dismissed
        // prompt or a missing PRF leaves the money reachable exactly as before.
        await storage().save(record);
        return { kind: 'passkey' as const, seed: new Uint8Array(seed) };
      } finally {
        seed.fill(0);
      }
    },

    async importWallet(seed) {
      if (seed.length !== SEED_BYTES) {
        throw new RangeError(`a seed must be ${SEED_BYTES} bytes, got ${seed.length}`);
      }
      if ((await storage().load()) !== null) {
        throw new WalletError('exists', 'a wallet already exists on this device');
      }
      if (!(await passkeySupported())) {
        throw new WalletError('unsupported', 'no passkey can be made here');
      }
      const made = await createPasskeyWallet(env(), rp);
      // The passkey's own derived seed is not this wallet's seed, and is not wanted.
      made.seed?.fill(0);
      if (made.credentialId === null || made.wrapKey === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      const record = await wrapSeed(env(), made.wrapKey, made.credentialId, seed);
      await storage().save(record);
      // A copy: the caller is free to wipe what it passed in, and usually should.
      return { kind: 'passkey', seed: new Uint8Array(seed) };
    },

    async signIn() {
      if ((await storage().load()) !== null) return this.unlock();
      const found = await findPasskeyWallet(env(), rp);
      if (found.credentialId === null) {
        throw new WalletError('no_wallet', 'no passkey for this site on this device');
      }
      if (found.seed === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      await storage().save({ kind: 'passkey', credentialId: found.credentialId });
      return { kind: 'passkey', seed: found.seed };
    },

    async forget() {
      await storage().clear();
    },
  };
}
