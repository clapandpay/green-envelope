// SPDX-License-Identifier: AGPL-3.0-or-later
// The demo's way in is the real one: given a keystore, `open()` takes the same three steps the
// real services take. Only the money on the other side is invented.
import type { KeyStore, UnlockedWallet, WalletKind } from '@ge/wallet';
import { WalletError } from '@ge/wallet';
import { describe, expect, it, vi } from 'vitest';
import { createMockServices } from './mock';

const SEED = new Uint8Array(32).fill(7);

/** A keystore that answers as told, without touching WebAuthn. */
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
    ...over,
  };
}

const demo = (keyStore: KeyStore, flags: 'nopasskey'[] = []) =>
  createMockServices({ keyStore, flags, latencyMs: 0, network: 'testnet11' });

describe('the demo makes a real passkey', () => {
  it('makes one when the device has nothing, and derives a real address from it', async () => {
    const keyStore = stubKeyStore();
    const create = vi.spyOn(keyStore, 'create');
    const wallet = await demo(keyStore).wallet.open();

    expect(create).toHaveBeenCalledTimes(1);
    expect(wallet.kind).toBe('passkey');
    // Not the invented address: derived from the seed the keystore gave back.
    expect(wallet.address.startsWith('txch1')).toBe(true);
    expect(wallet.address).not.toBe(
      'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u',
    );
  });

  it('unlocks the wallet already on the device instead of making a second one', async () => {
    const keyStore = stubKeyStore({ status: async () => ({ kind: 'passkey' }) });
    const unlock = vi.spyOn(keyStore, 'unlock');
    const create = vi.spyOn(keyStore, 'create');

    expect((await demo(keyStore).wallet.open()).kind).toBe('passkey');
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('adopts a passkey wallet made on another phone before making a new one', async () => {
    const keyStore = stubKeyStore({
      signIn: async () => ({ kind: 'passkey', seed: new Uint8Array(SEED) }),
    });
    const create = vi.spyOn(keyStore, 'create');

    expect((await demo(keyStore).wallet.open()).kind).toBe('passkey');
    expect(create).not.toHaveBeenCalled();
  });

  it('reports a dismissed prompt as cancelled, and makes nothing', async () => {
    const keyStore = stubKeyStore({
      create: async () => {
        throw new WalletError('cancelled');
      },
    });
    await expect(demo(keyStore).wallet.open()).rejects.toMatchObject({
      code: 'wallet_cancelled',
    });
  });

  it('falls back to a device wallet when asked for one', async () => {
    const keyStore = stubKeyStore({
      create: async () => ({ kind: 'device', seed: new Uint8Array(SEED) }),
    });
    const create = vi.spyOn(keyStore, 'create');

    expect((await demo(keyStore, ['nopasskey']).wallet.open()).kind).toBe('device');
    expect(create).toHaveBeenCalledWith({ prefer: 'device' });
  });

  it('still invents the wallet when no keystore is given, so tests stay still', async () => {
    const wallet = await createMockServices({ latencyMs: 0 }).wallet.open();
    expect(wallet.address).toBe('txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u');
  });
});
