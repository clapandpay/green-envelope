// SPDX-License-Identifier: AGPL-3.0-or-later
// One tap on the envelope, against the real services. The keystore is a stub because a real one
// would need a finger on a sensor, but everything it is wired into here is the shipped code.
import { TESTNET11 } from '@ge/chia';
import type { KeyStore, UnlockedWallet, WalletKind } from '@ge/wallet';
import { WalletError } from '@ge/wallet';
import { describe, expect, it, vi } from 'vitest';
import { createFakeChain } from '../test/fake-chain';
import { createLocalState } from './local-state';
import { createServicesFrom } from './real';
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
  const unlocked = (kind: WalletKind): UnlockedWallet => ({ kind, seed: new Uint8Array(SEED) });
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
      seed: new Uint8Array(seed),
    }),
    secureWithPasskey: async () => ({ kind: 'passkey' as const, seed: new Uint8Array(SEED) }),
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
  it('makes a passkey wallet when the device has nothing', async () => {
    const keyStore = stubKeyStore();
    const create = vi.spyOn(keyStore, 'create');
    const signIn = vi.spyOn(keyStore, 'signIn');

    const wallet = await appWith(keyStore).wallet.open();

    expect(wallet.kind).toBe('passkey');
    expect(wallet.address.startsWith('txch1')).toBe(true);
    // It looks for one elsewhere before making a new one, so a person with a passkey on
    // another phone never ends up with two wallets.
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('unlocks the wallet already on this device, and makes nothing', async () => {
    const keyStore = stubKeyStore({ status: async () => ({ kind: 'passkey' }) });
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
      signIn: async () => ({ kind: 'passkey', seed: new Uint8Array(SEED) }),
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
    // A dismissed prompt must never be read as "no passkey here" and quietly make a second one.
    expect(create).not.toHaveBeenCalled();
  });

  it('gives the same address every time for the same passkey', async () => {
    const first = await appWith(stubKeyStore()).wallet.open();
    const second = await appWith(stubKeyStore()).wallet.open();
    expect(second.address).toBe(first.address);
  });
});
