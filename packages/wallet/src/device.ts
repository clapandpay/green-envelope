// SPDX-License-Identifier: AGPL-3.0-or-later
// Device wallet: a random seed, wrapped with a non-extractable AES-GCM key that lives in IndexedDB.
import type { KeyStoreEnv } from './env';
import { WalletError } from './errors';
import type { OwnedBytes, StoredWallet } from './storage';

/** Seed length in bytes for both wallet kinds. */
export const SEED_BYTES = 32;
const IV_BYTES = 12;

type DeviceRecord = Extract<StoredWallet, { kind: 'device' }>;

/** Draws a fresh seed and returns it with the record to store. */
export async function createDeviceWallet(
  env: KeyStoreEnv,
): Promise<{ seed: OwnedBytes; record: DeviceRecord }> {
  const { subtle } = env.crypto;
  const seed = env.crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  const iv = env.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  // extractable = false: script can use the key while it has the handle, but never read its bytes.
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, seed));
  return { seed, record: { kind: 'device', key, iv, ciphertext } };
}

/** Decrypts the stored seed; any failure means the record is unusable. */
export async function unlockDeviceWallet(
  env: KeyStoreEnv,
  record: DeviceRecord,
): Promise<OwnedBytes> {
  let seed: OwnedBytes;
  try {
    const plain = await env.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      record.key,
      record.ciphertext,
    );
    seed = new Uint8Array(plain);
  } catch (cause) {
    throw new WalletError('corrupt', 'the device wallet cannot be decrypted', { cause });
  }
  if (seed.length !== SEED_BYTES)
    throw new WalletError('corrupt', 'the stored seed has a wrong length');
  return seed;
}
