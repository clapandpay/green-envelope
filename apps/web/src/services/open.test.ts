// SPDX-License-Identifier: AGPL-3.0-or-later
// One tap on the envelope, against the real services. The keystore is a stub because a real one
// would need a finger on a sensor, but everything it is wired into here is the shipped code.
import { TESTNET11 } from '@ge/chia';
import type { KeyStore, UnlockedWallet, WalletKind } from '@ge/wallet';
import { WalletError } from '@ge/wallet';
import { describe, expect, it, vi } from 'vitest';
import { MIN_SHARE_MOJOS } from '../lib/envelope-form';
import { createFakeChain } from '../test/fake-chain';
import { createLocalState } from './local-state';
import { createServicesFrom, DEFAULT_FEE_MOJOS, feeFromEnv } from './real';
import type { AppServices } from './types';

const SEED = new Uint8Array(32).fill(7);

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** A keystore that answers as told. Nothing here touches WebAuthn. */
function stubKeyStore(over: Partial<KeyStore> = {}): KeyStore {
  const unlocked = (kind: WalletKind): UnlockedWallet => ({
    kind,
    version: 1,
    seed: new Uint8Array(SEED),
    entropy: null,
  });
  return {
    status: async () => null,
    passkeySupported: async () => true,
    create: async () => unlocked('passkey'),
    unlock: async () => unlocked('passkey'),
    signIn: async () => {
      throw new WalletError('no_wallet');
    },
    forget: async () => {},
    importWallet: async (seed: Uint8Array) => ({
      kind: 'passkey' as const,
      version: 1 as const,
      seed: new Uint8Array(seed),
      entropy: null,
    }),
    secureWithPasskey: async () => ({
      kind: 'passkey' as const,
      version: 1 as const,
      seed: new Uint8Array(SEED),
      entropy: null,
    }),
    ...over,
  };
}

function appWith(keyStore: KeyStore): AppServices {
  return createServicesFrom({
    network: TESTNET11,
    chain: createFakeChain().chain,
    keyStore,
    state: createLocalState(memoryStorage()),
    origin: 'https://clapandpay.test',
    fetch: async () => new Response('{}', { status: 500 }),
    now: () => 1_800_000_000,
    fee: 0n,
    expirySeconds: 7 * 86_400,
  });
}

describe('one tap on the envelope', () => {
  it('never makes a wallet: a device with nothing on it is reported, not filled in', async () => {
    const keyStore = stubKeyStore();
    const create = vi.spyOn(keyStore, 'create');
    const signIn = vi.spyOn(keyStore, 'signIn');

    await expect(appWith(keyStore).wallet.open()).rejects.toMatchObject({
      code: 'no_wallet_here',
    });

    expect(signIn).toHaveBeenCalledTimes(1);
    // WebAuthn cannot tell "nothing here" from "dismissed", so creating on either answer
    // would eventually hand a returning person a second, empty wallet.
    expect(create).not.toHaveBeenCalled();
  });

  it('makes one through ensure(), which is the step a person asks for', async () => {
    const keyStore = stubKeyStore();
    const wallet = await appWith(keyStore).wallet.ensure();
    expect(wallet.kind).toBe('passkey');
    expect(wallet.address.startsWith('txch1')).toBe(true);
  });

  it('unlocks the wallet already on this device, and makes nothing', async () => {
    const keyStore = stubKeyStore({
      status: async () => ({ kind: 'passkey' as const, restorable: true }),
    });
    const unlock = vi.spyOn(keyStore, 'unlock');
    const create = vi.spyOn(keyStore, 'create');
    const signIn = vi.spyOn(keyStore, 'signIn');

    expect((await appWith(keyStore).wallet.open()).kind).toBe('passkey');
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('adopts the passkey wallet made on another phone', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => ({
        kind: 'passkey',
        version: 1,
        seed: new Uint8Array(SEED),
        entropy: null,
      }),
    });
    const create = vi.spyOn(keyStore, 'create');

    expect((await appWith(keyStore).wallet.open()).kind).toBe('passkey');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a dismissed prompt as cancelled and makes no wallet', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => {
        throw new WalletError('cancelled');
      },
    });
    const create = vi.spyOn(keyStore, 'create');

    await expect(appWith(keyStore).wallet.open()).rejects.toMatchObject({
      code: 'wallet_cancelled',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('gives the same address on any device the passkey reaches', async () => {
    // The wallet is derived from the passkey, so signing in on a new phone lands on the same
    // money rather than on an empty wallet that happens to share a name.
    const elsewhere = stubKeyStore({
      signIn: async () => ({
        kind: 'passkey',
        version: 1,
        seed: new Uint8Array(SEED),
        entropy: null,
      }),
    });
    const here = await appWith(stubKeyStore()).wallet.ensure();
    const there = await appWith(elsewhere).wallet.open();
    expect(there.address).toBe(here.address);
  });
});

describe('the fee a deployment gets when it does not name one', () => {
  it('is zero on a test chain and non-zero on mainnet', () => {
    // A zero fee is the first thing dropped when mainnet's mempool fills, and an envelope
    // that will not open for an hour is worse than one that costs a fraction of a cent.
    expect(feeFromEnv(undefined, 'testnet11')).toBe(0n);
    expect(feeFromEnv(undefined, 'mainnet')).toBeGreaterThan(0n);
  });

  it('stays far below the smallest share, which is what pays it', () => {
    // The opener pays the fee out of their own share, so the default must be invisible next
    // to the smallest share this app will make.
    expect(DEFAULT_FEE_MOJOS.mainnet * 100n).toBeLessThan(MIN_SHARE_MOJOS);
  });

  it('takes what the deployment says', () => {
    expect(feeFromEnv('25', 'mainnet')).toBe(25n);
    expect(feeFromEnv('0', 'mainnet')).toBe(0n); // deliberately zero is allowed
  });

  it('ignores a typo rather than taking the app down with it', () => {
    for (const bad of ['', '  ', 'lots', '-5', '1.5', '1e6']) {
      expect(feeFromEnv(bad, 'mainnet'), bad).toBe(DEFAULT_FEE_MOJOS.mainnet);
    }
  });
});

describe('ensure(): one tap, sign in before making a wallet (TASK-127, TASK-059)', () => {
  it('opens the passkey the phone already has and makes nothing', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => ({
        kind: 'passkey',
        version: 2,
        seed: new Uint8Array(SEED),
        entropy: null,
      }),
    });
    const create = vi.spyOn(keyStore, 'create');
    expect((await appWith(keyStore).wallet.ensure()).kind).toBe('passkey');
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['no_wallet', 'cancelled'] as const)(
    'makes one when sign-in ends with %s, named with the date',
    async (code) => {
      const keyStore = stubKeyStore({
        signIn: async () => {
          throw new WalletError(code);
        },
      });
      const create = vi.spyOn(keyStore, 'create');
      await appWith(keyStore).wallet.ensure();
      expect(create).toHaveBeenCalledTimes(1);
      // `now` is 1_800_000_000: 2027-01-15.
      expect(create.mock.calls[0]?.[0]).toEqual({ label: 'Clap and Pay wallet 2027-01-15' });
    },
  );

  it('never falls back to a browser-only wallet: no PRF is passkey_unavailable', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => {
        throw new WalletError('cancelled');
      },
      create: async () => {
        throw new WalletError('unsupported');
      },
    });
    await expect(appWith(keyStore).wallet.ensure()).rejects.toMatchObject({
      code: 'passkey_unavailable',
    });
  });

  it('says passkey_unavailable when the phone has the passkey but this browser has no PRF', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => {
        throw new WalletError('unsupported');
      },
    });
    const create = vi.spyOn(keyStore, 'create');
    await expect(appWith(keyStore).wallet.ensure()).rejects.toMatchObject({
      code: 'passkey_unavailable',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('makes a browser-only wallet only through keepInBrowser()', async () => {
    const keyStore = stubKeyStore();
    const create = vi.spyOn(keyStore, 'create');
    await appWith(keyStore).wallet.keepInBrowser();
    expect(create).toHaveBeenCalledWith({ prefer: 'device' });
  });

  it('makes a second passkey wallet in place of the current one through makeNew()', async () => {
    const keyStore = stubKeyStore();
    const create = vi.spyOn(keyStore, 'create');
    await appWith(keyStore).wallet.makeNew();
    expect(create).toHaveBeenCalledWith({ label: 'Clap and Pay wallet 2027-01-15', replace: true });
  });
});
