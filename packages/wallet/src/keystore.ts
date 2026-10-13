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
import {
  indexedDbStorage,
  type KeyStoreStorage,
  type StoredWallet,
  type WalletVersion,
} from './storage';

/** How the wallet's seed is protected. */
export type WalletKind = 'passkey' | 'device';

/**
 * An unlocked wallet.
 *
 * `seed` is what `accountFromSeed` and `masterSecretKey` take: for version 2 the 64-byte BIP-39
 * seed of the wallet's words, for version 1 the 32-byte seed itself. `entropy` is the 24 words
 * of a version 2 wallet (`mnemonicFromEntropy`), null for version 1, which has none. The caller
 * wipes both when done.
 */
export interface UnlockedWallet {
  kind: WalletKind;
  version: WalletVersion;
  seed: Uint8Array;
  entropy: Uint8Array | null;
  /**
   * The version 1 seed this passkey also derives, from the same prompt: the wallet it held
   * before 24 words, whose money is moved once (TASK-128). Only on a passkey wallet opened or
   * found here; a passkey made just now never held one.
   */
  earlierSeed?: Uint8Array;
}

/** Wipes what an unlocked wallet holds: its seed, its words and its earlier seed. */
export function wipeUnlocked(wallet: UnlockedWallet): void {
  wallet.seed.fill(0);
  wallet.entropy?.fill(0);
  wallet.earlierSeed?.fill(0);
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
  status(): Promise<{ kind: WalletKind; version: WalletVersion; restorable: boolean } | null>;
  /** WebAuthn with a user-verifying platform authenticator, and PRF not known to be missing. */
  passkeySupported(): Promise<boolean>;
  /**
   * Creates a version 2 wallet (24 words). A passkey wallet unless `prefer` is `'device'`;
   * never a device wallet in its place: without PRF it rejects with `unsupported`, so the
   * person is told and can choose a device wallet themselves (audit M2). `label` is the
   * passkey's user name, which tells one wallet from another in the phone's passkey list.
   *
   * `replace` makes a new passkey wallet in place of the passkey wallet remembered here. Only
   * a derived one: it stays in the person's passkey list and comes back with `signIn()`.
   * A device or wrapped wallet lives only here, so it is never replaced (`exists`). The old
   * record is overwritten only once the new passkey exists.
   */
  create(opts?: {
    prefer?: WalletKind;
    label?: string;
    replace?: boolean;
  }): Promise<UnlockedWallet>;
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
  version: WalletVersion,
): Promise<WrappedRecord> {
  const iv = env.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // An ArrayBuffer-backed copy: WebCrypto wants one, and the caller's array may be a view on
  // something else. Wiped again below, so the seed exists here for no longer than the encrypt.
  const owned = new Uint8Array(seed);
  try {
    const ciphertext = new Uint8Array(
      await env.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, owned),
    );
    return { kind: 'wrapped', version, credentialId, iv, ciphertext };
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

/**
 * The unlocked wallet of a record's 32 secret bytes. Takes ownership of `secret`: for version 2
 * it becomes `entropy`, for version 1 it is the seed.
 */
async function unlockedFrom(
  kind: WalletKind,
  version: WalletVersion,
  secret: Uint8Array,
): Promise<UnlockedWallet> {
  if (version === 1) return { kind, version, seed: secret, entropy: null };
  // Loaded when a wallet opens, not with the page: the word list is most of its size, and the
  // claim route has a budget (`pnpm --filter web size`).
  const { seedFromEntropy } = await import('./mnemonic');
  return { kind, version, seed: await seedFromEntropy(secret), entropy: secret };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Whether two records are the same record (what `commit` compares against). */
function sameRecord(a: StoredWallet | null, b: StoredWallet | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.version !== b.version) return false;
  if (a.kind === 'device' && b.kind === 'device') return sameBytes(a.ciphertext, b.ciphertext);
  if (a.kind === 'device' || b.kind === 'device') return false;
  return sameBytes(a.credentialId, b.credentialId);
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

  /**
   * Saves `record` only if the stored record is still `expected`. A passkey prompt can take a
   * minute, and another tab may have made a wallet meanwhile, a device wallet whose secret is
   * nowhere else; overwriting it would lose that money (audit L-2). Not a transaction, but the
   * window shrinks from the length of a prompt to one IndexedDB round trip.
   */
  async function commit(expected: StoredWallet | null, record: StoredWallet): Promise<void> {
    if (!sameRecord(expected, await storage().load())) {
      throw new WalletError('exists', 'another tab changed the wallet on this device');
    }
    await storage().save(record);
  }

  async function createDevice(): Promise<UnlockedWallet> {
    const { seed, record } = await createDeviceWallet(env());
    await commit(null, record);
    return unlockedFrom('device', record.version, seed);
  }

  return {
    async status() {
      const stored = await storage().load();
      if (stored === null) return null;
      // 'wrapped' is a storage detail: it opens with the passkey, so that is the kind. It is
      // not restorable, though, because the wrapped seed is here and only here.
      return {
        kind: stored.kind === 'device' ? 'device' : 'passkey',
        version: stored.version,
        restorable: stored.kind === 'passkey',
      };
    },

    passkeySupported,

    async create(createOpts) {
      const existing = await storage().load();
      const replaceable =
        createOpts?.replace === true &&
        existing?.kind === 'passkey' &&
        // A version 1 wallet comes back with sign-in only as version 2, which is another
        // address: replacing it would leave its money where the app no longer looks (TASK-128).
        existing.version === 2 &&
        createOpts.prefer !== 'device';
      if (existing !== null && !replaceable) {
        throw new WalletError('exists', 'a wallet already exists on this device');
      }
      if (createOpts?.prefer === 'device') return createDevice();
      if (!(await passkeySupported())) {
        throw new WalletError('unsupported', 'no passkey wallet can be made in this browser');
      }
      let made: Awaited<ReturnType<typeof createPasskeyWallet>>;
      try {
        made = await createPasskeyWallet(env(), rp, createOpts?.label);
      } catch (error) {
        if (error instanceof WalletError) throw error; // cancelled: the user decides what is next
        // A broken WebAuthn stack: say so, and let the person choose a device wallet.
        throw new WalletError('unsupported', 'the passkey could not be made', { cause: error });
      }
      made.seed?.fill(0); // the version 1 seed: not this wallet
      if (made.entropy === null || made.credentialId === null) {
        throw new WalletError('unsupported', 'this passkey cannot evaluate PRF');
      }
      await commit(existing, { kind: 'passkey', version: 2, credentialId: made.credentialId });
      return unlockedFrom('passkey', 2, made.entropy);
    },

    async unlock() {
      const stored = await storage().load();
      if (stored === null) throw new WalletError('no_wallet', 'create a wallet first');
      if (stored.kind === 'device') {
        return unlockedFrom('device', stored.version, await unlockDeviceWallet(env(), stored));
      }
      const opened = await unlockPasskeyWallet(env(), rp, stored.credentialId);
      if (stored.kind === 'wrapped') {
        // This wallet's secret is the wrapped one; what the passkey derives is not wanted here
        // and does not get to linger on the heap.
        opened.seed?.fill(0);
        opened.entropy?.fill(0);
        const { wrapKey } = opened;
        if (wrapKey === null) {
          throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
        }
        const secret = await unwrapSeed(env(), wrapKey, stored);
        return unlockedFrom('passkey', stored.version, secret);
      }
      if (opened.seed === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      if (stored.version === 1) {
        // From now on this is the passkey's 24-word wallet. Nothing is lost: the version 1 seed
        // comes from the same passkey every time, and is handed over below so its money is
        // found and moved (TASK-128).
        await commit(stored, { ...stored, version: 2 });
      }
      const wallet = await unlockedFrom('passkey', 2, opened.entropy);
      return { ...wallet, earlierSeed: opened.seed };
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
        // The passkey's own keys are not this wallet's.
        made.seed?.fill(0);
        made.entropy?.fill(0);
        if (made.credentialId === null || made.wrapKey === null) {
          throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
        }
        const record = await wrapSeed(env(), made.wrapKey, made.credentialId, seed, stored.version);
        // Only now: until this line the device wallet is still the record, so a dismissed
        // prompt or a missing PRF leaves the money reachable exactly as before.
        await commit(stored, record);
        return await unlockedFrom('passkey', stored.version, new Uint8Array(seed));
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
      // The passkey's own derived keys are not this wallet's, and are not wanted.
      made.seed?.fill(0);
      made.entropy?.fill(0);
      if (made.credentialId === null || made.wrapKey === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      // A seed from elsewhere is a version 1 seed: there are no words for it.
      const record = await wrapSeed(env(), made.wrapKey, made.credentialId, seed, 1);
      await commit(null, record);
      // A copy: the caller is free to wipe what it passed in, and usually should.
      return unlockedFrom('passkey', 1, new Uint8Array(seed));
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
      // A passkey found here is its 24-word wallet. One that held a version 1 wallet somewhere
      // else hands over that seed too, so its money is found and moved (TASK-128).
      await commit(null, { kind: 'passkey', version: 2, credentialId: found.credentialId });
      const wallet = await unlockedFrom('passkey', 2, found.entropy);
      return { ...wallet, earlierSeed: found.seed };
    },

    async forget() {
      await storage().clear();
    },
  };
}
