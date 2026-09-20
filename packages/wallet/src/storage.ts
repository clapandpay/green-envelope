// SPDX-License-Identifier: AGPL-3.0-or-later
import { WalletError } from './errors';

/** Bytes backed by a plain ArrayBuffer, as WebCrypto and WebAuthn want them. */
export type OwnedBytes = Uint8Array<ArrayBuffer>;

/**
 * What the keystore persists.
 *
 * - `passkey`: nothing secret at all. The seed is derived from the passkey every time.
 * - `device`: a seed wrapped by a non-extractable key that lives in IndexedDB. No face needed,
 *   and it is lost with the browser profile.
 * - `wrapped`: a seed the passkey did not make — one brought from another wallet, or a device
 *   wallet put behind a face — encrypted under a key derived from the same passkey with a
 *   different HKDF `info`. Opening it needs the passkey, so it is a passkey wallet to the
 *   person holding it; it just has a seed of its own rather than a derived one.
 */
export type StoredWallet =
  | { kind: 'passkey'; credentialId: OwnedBytes }
  | { kind: 'device'; key: CryptoKey; iv: OwnedBytes; ciphertext: OwnedBytes }
  | { kind: 'wrapped'; credentialId: OwnedBytes; iv: OwnedBytes; ciphertext: OwnedBytes };

/** Where the keystore keeps its single record. Values must survive a structured clone (CryptoKey included). */
export interface KeyStoreStorage {
  load(): Promise<StoredWallet | null>;
  save(wallet: StoredWallet): Promise<void>;
  clear(): Promise<void>;
}

const STORE = 'keystore';
const RECORD_KEY = 'wallet';

function isOwnedBytes(value: unknown): value is OwnedBytes {
  return value instanceof Uint8Array && value.buffer instanceof ArrayBuffer;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof value === 'object' &&
    value !== null &&
    'algorithm' in value &&
    'usages' in value &&
    'extractable' in value
  );
}

/** Narrows whatever came out of storage: nothing is `null`, an unknown shape throws 'corrupt' (never silently "no wallet"). */
export function parseStoredWallet(value: unknown): StoredWallet | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') {
    const v: {
      kind?: unknown;
      credentialId?: unknown;
      key?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    } = value;
    if (v.kind === 'passkey' && isOwnedBytes(v.credentialId)) {
      return { kind: 'passkey', credentialId: v.credentialId };
    }
    if (
      v.kind === 'wrapped' &&
      isOwnedBytes(v.credentialId) &&
      isOwnedBytes(v.iv) &&
      isOwnedBytes(v.ciphertext)
    ) {
      return {
        kind: 'wrapped',
        credentialId: v.credentialId,
        iv: v.iv,
        ciphertext: v.ciphertext,
      };
    }
    if (
      v.kind === 'device' &&
      isCryptoKey(v.key) &&
      isOwnedBytes(v.iv) &&
      isOwnedBytes(v.ciphertext)
    ) {
      return { kind: 'device', key: v.key, iv: v.iv, ciphertext: v.ciphertext };
    }
  }
  throw new WalletError('corrupt', 'the stored wallet record has an unknown shape');
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const req = factory.open(name, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore(STORE);
  };
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open is blocked by another tab'));
  });
}

/** The default storage: one record in one IndexedDB object store. */
export function indexedDbStorage(
  factory: IDBFactory | undefined,
  dbName = 'ge-wallet',
): KeyStoreStorage {
  async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>) {
    if (factory === undefined) throw new WalletError('storage', 'IndexedDB is not available');
    try {
      const db = await open(factory, dbName);
      try {
        const tx = db.transaction(STORE, mode);
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        const result = await request(op(tx.objectStore(STORE)));
        await done; // resolve only once the write is durable
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
    async load() {
      return parseStoredWallet(await run<unknown>('readonly', (s) => s.get(RECORD_KEY)));
    },
    async save(wallet) {
      await run('readwrite', (s) => s.put(wallet, RECORD_KEY));
    },
    async clear() {
      await run('readwrite', (s) => s.delete(RECORD_KEY));
    },
  };
}
