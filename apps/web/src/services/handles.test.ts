// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { handlesApiFor, parseHandle, readHandle, resolveHandle, XCHANDLES_API } from './handles';

const PUZZLE_HASH = 'a'.repeat(64);
const NOW = 1_700_000_000;

function registryAnswer(over: Record<string, unknown> = {}) {
  return {
    handle: 'anna',
    slot: { expiration: NOW + 86_400 },
    resolved_singleton: { melted: false, nft: { p2_puzzle_hash: PUZZLE_HASH } },
    ...over,
  };
}

describe('parseHandle', () => {
  it('takes a handle with or without the @, and lowercases it', () => {
    expect(parseHandle('@Anna')).toBe('anna');
    expect(parseHandle('  anna ')).toBe('anna');
  });

  it('is null for anything that cannot be a handle', () => {
    expect(parseHandle('@a')).toBeNull(); // too short
    expect(parseHandle('@uncle.kai')).toBeNull(); // the registry's alphabet is letters and digits
    expect(parseHandle(`@${'a'.repeat(64)}`)).toBeNull(); // too long
    expect(parseHandle('@')).toBeNull();
  });
});

describe('readHandle', () => {
  it('reads a healthy handle into what the screen needs', () => {
    const resolved = readHandle('anna', registryAnswer(), 'xch', NOW);
    expect(resolved.handle).toBe('anna');
    expect(resolved.address.startsWith('xch1')).toBe(true);
    expect(resolved.pendingTransfer).toBe(false);
    expect(resolved.expiration).toBe(NOW + 86_400);
  });

  it('uses the network prefix it is given', () => {
    expect(readHandle('anna', registryAnswer(), 'txch', NOW).address.startsWith('txch1')).toBe(
      true,
    );
  });

  // Each of these used to be a single "check the spelling", which is wrong advice for all of them.
  it('separates a name nobody has from one that lapsed', () => {
    expect(() => readHandle('anna', null, 'xch', NOW)).toThrow(
      expect.objectContaining({ code: 'handle_not_found' }),
    );
    expect(() =>
      readHandle('anna', registryAnswer({ handle: 'someone-else' }), 'xch', NOW),
    ).toThrow(expect.objectContaining({ code: 'handle_not_found' }));
    expect(() =>
      readHandle('anna', registryAnswer({ slot: { expiration: NOW - 1 } }), 'xch', NOW),
    ).toThrow(expect.objectContaining({ code: 'handle_expired' }));
  });

  it('separates a name that exists but cannot take money', () => {
    const melted = registryAnswer({
      resolved_singleton: { melted: true, nft: { p2_puzzle_hash: PUZZLE_HASH } },
    });
    expect(() => readHandle('anna', melted, 'xch', NOW)).toThrow(
      expect.objectContaining({ code: 'handle_not_payable' }),
    );

    const noNft = registryAnswer({ resolved_singleton: { melted: false, nft: null } });
    expect(() => readHandle('anna', noNft, 'xch', NOW)).toThrow(
      expect.objectContaining({ code: 'handle_not_payable' }),
    );

    const badHash = registryAnswer({
      resolved_singleton: { melted: false, nft: { p2_puzzle_hash: 'nonsense' } },
    });
    expect(() => readHandle('anna', badHash, 'xch', NOW)).toThrow(
      expect.objectContaining({ code: 'handle_not_payable' }),
    );
  });

  it('reports an ownership change that is on its way', () => {
    const moving = registryAnswer({ pending_transfer: { to: 'someone' } });
    expect(readHandle('anna', moving, 'xch', NOW).pendingTransfer).toBe(true);
    expect(
      readHandle('anna', registryAnswer({ pending_transfer: false }), 'xch', NOW).pendingTransfer,
    ).toBe(false);
  });
});

describe('resolveHandle', () => {
  const ok = () =>
    new Response(JSON.stringify(registryAnswer()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('asks the registry for the bare handle', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok());
    const resolved = await resolveHandle('@Anna', 'xch', fetchFn, NOW);
    expect(resolved.handle).toBe('anna');
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://api.xchandles.com/handle/anna');
  });

  it('calls a registry that is down unavailable, not a spelling mistake', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(resolveHandle('@anna', 'xch', offline, NOW)).rejects.toMatchObject({
      code: 'handles_unavailable',
    });

    const broken = vi.fn().mockResolvedValue(new Response('no', { status: 500 }));
    await expect(resolveHandle('@anna', 'xch', broken, NOW)).rejects.toMatchObject({
      code: 'handles_unavailable',
    });
  });

  it('calls a missing handle not found', async () => {
    const missing = vi.fn().mockResolvedValue(new Response('no', { status: 404 }));
    await expect(resolveHandle('@anna', 'xch', missing, NOW)).rejects.toMatchObject({
      code: 'handle_not_found',
    });
  });

  it('refuses something that is not a handle without asking anyone', async () => {
    const fetchFn = vi.fn();
    await expect(resolveHandle('@a', 'xch', fetchFn, NOW)).rejects.toMatchObject({
      code: 'invalid_recipient',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('which registry a chain uses', () => {
  it('is the XCHandles one on mainnet', () => {
    expect(handlesApiFor('mainnet', undefined)).toBe(XCHANDLES_API);
  });

  it('is nothing on a test chain, because XCHandles does not index one', () => {
    // Their `launcher_id` chooses between registries on one network, not between networks,
    // and no testnet base URL is published. So the send screen says so instead of guessing.
    expect(handlesApiFor('testnet11', undefined)).toBeNull();
  });

  it('is whatever a deployment names, on either chain', () => {
    // The day a testnet registry exists, or somebody runs their own, it works here with no
    // change to this file.
    expect(handlesApiFor('testnet11', 'https://handles.test')).toBe('https://handles.test');
    expect(handlesApiFor('mainnet', 'https://handles.test')).toBe('https://handles.test');
    expect(handlesApiFor('testnet11', '   ')).toBeNull();
  });

  it('asks the registry it was given, not a hardcoded one', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(registryAnswer()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await resolveHandle('@anna', 'txch', fetchFn, NOW, 'https://handles.test/');
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://handles.test/handle/anna');
  });
});
