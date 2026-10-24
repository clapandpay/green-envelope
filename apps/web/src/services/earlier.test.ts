// SPDX-License-Identifier: AGPL-3.0-or-later
// An old wallet (its key lived in the browser) moves into the passkey vault once: its money is
// shown without a prompt, and one move opens the old key a last time, sweeps the money and
// launches the vault in the same transaction.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../test/world';

const XCH = 1_000_000_000_000n;

describe('money in the old wallet', () => {
  it('is shown without a prompt, and moved into a new vault in one step', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    world.fundLegacy(3n * XCH);
    // The old app's wallet record is put aside; the first tap makes the passkey.
    expect(await world.services.wallet.current()).toBeNull();
    expect(await world.services.wallet.earlier()).toMatchObject({ balance: 3n * XCH });
    expect(world.prompts()).toBe(0);

    const moved = await world.services.wallet.moveEarlier();
    expect(moved).toMatchObject({ amount: 3n * XCH - 1n, more: false });
    world.fake.farmBlock();
    await moved.confirmed;
    expect((await world.services.wallet.balance()).confirmed).toBe(3n * XCH - 1n);
    expect(await world.services.wallet.earlier()).toBeNull();
  });

  it('moves a device wallet too, and its earlier address with it', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'device', earlier: 'anna' } } });
    world.fundLegacy(2n * XCH);
    world.fundLegacy(XCH, 'earlier');
    await world.services.wallet.current();
    const moved = await world.services.wallet.moveEarlier();
    expect(moved.amount).toBe(3n * XCH - 1n);
    world.fake.farmBlock();
    await moved.confirmed;
    expect((await world.services.wallet.balance()).confirmed).toBe(3n * XCH - 1n);
  });

  it('is nothing to show when the old wallet is empty', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    await world.services.wallet.current();
    expect(await world.services.wallet.earlier()).toBeNull();
  });

  it('moves at most 50 coins at a time and says when more are left', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    for (let i = 0; i < 52; i += 1) world.fundLegacy(XCH + BigInt(i));
    await world.services.wallet.current();
    const first = await world.services.wallet.moveEarlier();
    expect(first.more).toBe(true);
    world.fake.farmBlock();
    await first.confirmed;
    const second = await world.services.wallet.moveEarlier();
    expect(second.more).toBe(false);
  });

  it('stays where it is when the move fails, and the next try moves it', async () => {
    const world = createWorld({ keyStore: { legacy: { kind: 'passkey' } } });
    world.fundLegacy(2n * XCH);
    await world.services.wallet.current();
    world.goOffline(1);
    await expect(world.services.wallet.moveEarlier()).rejects.toMatchObject({ code: 'network' });
    world.comeBack();
    expect(await world.services.wallet.earlier()).toMatchObject({ balance: 2n * XCH });
    const moved = await world.services.wallet.moveEarlier();
    world.fake.farmBlock();
    await moved.confirmed;
    expect(await world.services.wallet.earlier()).toBeNull();
  });
});
