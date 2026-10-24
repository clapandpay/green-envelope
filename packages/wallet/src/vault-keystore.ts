// SPDX-License-Identifier: AGPL-3.0-or-later
// The wallet of a browser profile: which passkey it is, and which vault that passkey controls.
// Everything stored here is public (a credential id, a public key, a launcher id). There is no
// seed and no key to protect: losing this record loses nothing, `signIn` finds it again.
import type { Bytes } from '@ge/chia';
import type { Passkey, RelyingParty, SignerEnv } from '@ge/passkey-signer';
import {
  browserSignerEnv,
  createPasskey,
  findPasskey,
  narrowKey,
  SignerError,
  signChallenge,
} from '@ge/passkey-signer';
import type { Assertion } from '@ge/vault';
import { WalletError } from './errors';

/** One browser's wallet: a passkey and, once launched, its vault. */
export interface VaultRecord {
  credentialId: Bytes;
  /** 33-byte compressed P-256 public key of the passkey. */
  publicKey: Bytes;
  /** The vault's launcher id, set as soon as the launch is sent; null before. */
  launcherId: Bytes | null;
}

/** Where the record lives. Values must survive a structured clone. */
export interface VaultStorage {
  load(): Promise<VaultRecord | null>;
  save(record: VaultRecord): Promise<void>;
  clear(): Promise<void>;
}

/** The wallet's passkey: make it, find it, ask it to sign. */
export interface VaultKeyStore {
  /** The record of this browser, without prompting. */
  status(): Promise<VaultRecord | null>;
  /** Whether this browser can ask a passkey at all. */
  passkeySupported(): Promise<boolean>;
  /** Makes a new passkey (one prompt) and remembers it here, in place of any other. */
  create(label: string): Promise<VaultRecord>;
  /**
   * Finds a passkey this person already has (one prompt) without remembering it: the caller
   * decides, with the chain, which of the candidate keys it is.
   */
  find(): Promise<{ credentialId: Bytes; candidates: Bytes[] }>;
  /** A second signature settles which candidate is the passkey's key (one prompt). */
  narrow(credentialId: Bytes, candidates: Bytes[]): Promise<Bytes>;
  /** Remembers a passkey found with `find`. */
  remember(record: VaultRecord): Promise<void>;
  /** Asks the remembered passkey to sign `challenge` (one prompt). */
  sign(challenge: Bytes): Promise<Assertion>;
  /** Records the vault's launcher id once its launch has been sent. */
  setLauncher(launcherId: Bytes): Promise<void>;
  /** Forgets the record. Nothing is lost: the passkey and the vault are where they were. */
  forget(): Promise<void>;
}

/** Options of `createVaultKeyStore`; everything defaults to the browser. */
export interface VaultKeyStoreOptions {
  rpId?: string;
  rpName?: string;
  storage?: VaultStorage;
  env?: SignerEnv;
}

function translate(error: unknown): unknown {
  if (!(error instanceof SignerError)) return error;
  const code = error.code === 'cancelled' ? 'cancelled' : 'unsupported';
  return new WalletError(code, error.message, { cause: error });
}

async function signer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

/** Creates the keystore. Nothing is touched until a method is called. */
export function createVaultKeyStore(opts: VaultKeyStoreOptions = {}): VaultKeyStore {
  const env = (): SignerEnv => opts.env ?? browserSignerEnv();
  const rp: RelyingParty = { rpId: opts.rpId, rpName: opts.rpName ?? 'Green Envelope' };
  let fallback: VaultStorage | undefined;
  const storage = (): VaultStorage => {
    if (opts.storage !== undefined) return opts.storage;
    fallback ??= indexedDbVaultStorage(globalThis.indexedDB);
    return fallback;
  };

  return {
    status: () => storage().load(),

    async passkeySupported() {
      return env().credentials !== undefined;
    },

    async create(label) {
      const made: Passkey = await signer(() => createPasskey(env(), rp, label));
      const record: VaultRecord = { ...made, launcherId: null };
      await storage().save(record);
      return record;
    },

    find: () => signer(() => findPasskey(env(), rp)),

    narrow: (credentialId, candidates) =>
      signer(() => narrowKey(env(), rp, credentialId, candidates)),

    remember: (record) => storage().save(record),

    async sign(challenge) {
      const record = await storage().load();
      if (record === null) throw new WalletError('no_wallet', 'no passkey here');
      const { assertion } = await signer(() =>
        signChallenge(env(), rp, challenge, record.credentialId),
      );
      return assertion;
    },

    async setLauncher(launcherId) {
      const record = await storage().load();
      if (record === null) throw new WalletError('no_wallet', 'no passkey here');
      await storage().save({ ...record, launcherId });
    },

    forget: () => storage().clear(),
  };
}

const STORE = 'keystore';
const KEY = 'vault';

function isBytes(value: unknown): value is Bytes {
  return value instanceof Uint8Array;
}

/** Reads a stored record; anything else is `corrupt`, never silently "no wallet". */
export function parseVaultRecord(value: unknown): VaultRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    const v = value as Partial<Record<keyof VaultRecord, unknown>>;
    if (
      isBytes(v.credentialId) &&
      isBytes(v.publicKey) &&
      v.publicKey.length === 33 &&
      (v.launcherId === null || (isBytes(v.launcherId) && v.launcherId.length === 32))
    ) {
      return { credentialId: v.credentialId, publicKey: v.publicKey, launcherId: v.launcherId };
    }
  }
  throw new WalletError('corrupt', 'the stored wallet record has an unknown shape');
}

/** In memory, for tests and for browsers without IndexedDB. */
export function memoryVaultStorage(): VaultStorage {
  let record: VaultRecord | null = null;
  return {
    load: async () => record,
    save: async (next) => {
      record = next;
    },
    clear: async () => {
      record = null;
    },
  };
}

/** The default storage: one record in its own IndexedDB database (not the legacy `ge-wallet`). */
export function indexedDbVaultStorage(
  factory: IDBFactory | undefined,
  dbName = 'ge-vault',
): VaultStorage {
  async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>) {
    if (factory === undefined) throw new WalletError('storage', 'IndexedDB is not available');
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = factory.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open is blocked by another tab'));
      });
      try {
        const tx = db.transaction(STORE, mode);
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        const req = op(tx.objectStore(STORE));
        const result = await new Promise<T>((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await done;
        return result;
      } finally {
        db.close();
      }
    } catch (cause) {
      if (cause instanceof WalletError) throw cause;
      throw new WalletError('storage', cause instanceof Error ? cause.message : String(cause), {
        cause,
      });
    }
  }
  return {
    load: async () => parseVaultRecord(await run<unknown>('readonly', (s) => s.get(KEY))),
    save: async (record) => {
      await run('readwrite', (s) => s.put(record, KEY));
    },
    clear: async () => {
      await run('readwrite', (s) => s.delete(KEY));
    },
  };
}
