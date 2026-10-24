// SPDX-License-Identifier: AGPL-3.0-or-later
import { fakePasskeys } from '@ge/passkey-signer/fake';
import { describe, expect, it } from 'vitest';
import { createVaultKeyStore, memoryVaultStorage, parseVaultRecord } from './vault-keystore';

describe('the vault keystore', () => {
  it('keeps one passkey and a separate vault per network', async () => {
    const phone = fakePasskeys();
    const storage = memoryVaultStorage();
    const main = createVaultKeyStore({ network: 'mainnet', env: phone.env, storage });
    const test = createVaultKeyStore({ network: 'testnet11', env: phone.env, storage });
    const made = await main.create('x');
    await test.setLauncher(new Uint8Array(32).fill(1));
    expect((await main.status())?.launcherId).toBeNull();
    expect((await test.status())?.launcherId).toEqual(new Uint8Array(32).fill(1));
    expect((await test.status())?.publicKey).toEqual(made.publicKey);
    await main.setLauncher(new Uint8Array(32).fill(2));
    await test.setLauncher(null);
    expect((await main.status())?.launcherId).toEqual(new Uint8Array(32).fill(2));
    expect((await test.status())?.launcherId).toBeNull();
  });

  it('reads a record from before networks, keeping the passkey and dropping the launcher', () => {
    const parsed = parseVaultRecord({
      credentialId: new Uint8Array(4),
      publicKey: new Uint8Array(33).fill(2),
      launcherId: new Uint8Array(32),
    });
    expect(parsed?.launchers).toEqual({});
    expect(() => parseVaultRecord({ nonsense: true })).toThrow(/corrupt/);
  });

  it('stores nothing secret: an id, a public key and launcher ids', async () => {
    const storage = memoryVaultStorage();
    const keyStore = createVaultKeyStore({ env: fakePasskeys().env, storage });
    await keyStore.create('x');
    expect(Object.keys((await storage.load()) ?? {}).sort()).toEqual([
      'credentialId',
      'launchers',
      'publicKey',
    ]);
  });
});
