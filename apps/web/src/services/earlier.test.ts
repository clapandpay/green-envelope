// SPDX-License-Identifier: AGPL-3.0-or-later
// Moving the money of a wallet from before 24 words into the 24-word wallet (TASK-128), against
// the real services over a chain in memory.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../test/world';

const XCH = 1_000_000_000_000n;

describe('money at the earlier address', () => {
  it('is shown after sign-in, without a prompt, and moved in one step', async () => {
    const world = createWorld({ keyStore: { earlier: 'anna' } });
    world.fundEarlier(3n * XCH);
    const { address } = await world.services.wallet.ensure();

    const earlier = await world.services.wallet.earlier();
    expect(earlier?.balance).toBe(3n * XCH);
    expect(earlier?.address).not.toBe(address);

    const moved = await world.services.wallet.moveEarlier();
    expect(moved).toMatchObject({ amount: 3n * XCH, more: false });
    world.fake.farmBlock();
    await moved.confirmed;

    expect(await world.services.wallet.earlier()).toBeNull();
    expect((await world.services.wallet.balance()).confirmed).toBe(3n * XCH);
  });

  it('is nothing to show when the earlier address is empty', async () => {
    const world = createWorld({ keyStore: { earlier: 'anna' } });
    await world.services.wallet.ensure();
    expect(await world.services.wallet.earlier()).toBeNull();
  });

  it('stays where it is when the move fails, and the next try moves it', async () => {
    const world = createWorld({ keyStore: { earlier: 'anna' } });
    world.fundEarlier(2n * XCH);
    await world.services.wallet.ensure();

    world.goOffline(1); // the coin lookup of the move
    await expect(world.services.wallet.moveEarlier()).rejects.toMatchObject({ code: 'network' });
    expect((await world.services.wallet.earlier())?.balance).toBe(2n * XCH);

    const moved = await world.services.wallet.moveEarlier();
    world.fake.farmBlock();
    await moved.confirmed;
    expect(await world.services.wallet.earlier()).toBeNull();
  });

  it('moves at most 50 coins at a time and says when more are left', async () => {
    const world = createWorld({ keyStore: { earlier: 'anna' } });
    for (let i = 0; i < 52; i += 1) world.fundEarlier(XCH + BigInt(i));
    await world.services.wallet.ensure();

    const first = await world.services.wallet.moveEarlier();
    expect(first.more).toBe(true);
    world.fake.farmBlock();
    await first.confirmed;
    const second = await world.services.wallet.moveEarlier();
    expect(second.more).toBe(false);
    world.fake.farmBlock();
    await second.confirmed;
    expect(await world.services.wallet.earlier()).toBeNull();
  });

  it('takes an envelope sent from the earlier wallet back into the new one', async () => {
    const world = createWorld({ seedName: 'before' });
    const sent = await world.makeEnvelope();
    // The same browser, now on the wallet that replaced it.
    await world.services.wallet.forget();
    world.switchSeed('after');
    const { address } = await world.services.wallet.ensure();
    const before = (await world.services.wallet.balance()).confirmed;

    const back = await world.services.envelopes.takeBack(sent.id);
    world.fake.farmBlock();
    await back.confirmed;

    expect((await world.services.wallet.balance()).confirmed - before).toBe(back.amount);
    expect(address).toMatch(/^txch1/);
  });
});
