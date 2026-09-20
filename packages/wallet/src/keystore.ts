// SPDX-License-Identifier: AGPL-3.0-or-later
import { createDeviceWallet, unlockDeviceWallet } from './device';
import { browserEnv, type KeyStoreEnv } from './env';
import { WalletError } from './errors';
import {
  createPasskeyWallet,
  findPasskeyWallet,
  type RelyingParty,
  unlockPasskeyWallet,
} from './passkey';
import { indexedDbStorage, type KeyStoreStorage } from './storage';

/** How the wallet's seed is protected. */
export type WalletKind = 'passkey' | 'device';

/** An unlocked wallet: its kind and its 32-byte seed. */
export interface UnlockedWallet {
  kind: WalletKind;
  seed: Uint8Array;
}

/** Creates, unlocks and forgets the one wallet of this browser profile. */
export interface KeyStore {
  /** What exists on this device, without prompting the user. */
  status(): Promise<{ kind: WalletKind } | null>;
  /** WebAuthn with a user-verifying platform authenticator, and PRF not known to be missing. */
  passkeySupported(): Promise<boolean>;
  /** Creates a wallet and returns its 32-byte seed. Prefers passkey when `prefer` allows and it is supported. */
  create(opts?: { prefer?: WalletKind }): Promise<UnlockedWallet>;
  /** Returns the seed of the existing wallet (passkey: prompts biometrics). */
  unlock(): Promise<UnlockedWallet>;
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

  async function passkeySupported(): Promise<boolean> {
    const { credentials, publicKeyCredential: pkc } = env();
    if (credentials === undefined || pkc === undefined) return false;
    try {
      if ((await pkc.isUserVerifyingPlatformAuthenticatorAvailable?.()) !== true) return false;
      const prf = (await pkc.getClientCapabilities?.())?.['extension:prf'];
      // Unknown (older browsers) means "try and see": create() falls back if PRF is missing.
      return prf !== false;
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
      return stored === null ? null : { kind: stored.kind };
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
      const { seed } = await unlockPasskeyWallet(env(), rp, stored.credentialId);
      if (seed === null) {
        throw new WalletError('unsupported', 'this browser cannot evaluate PRF for the passkey');
      }
      return { kind: 'passkey', seed };
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
