// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { explorerAddress, explorerCoin } from './explorer';

describe('mempoolxch.space links', () => {
  it('name a coin or an address, and testnet says so', () => {
    expect(explorerCoin('ab'.repeat(32), 'mainnet')).toBe(
      `https://mempoolxch.space/coin/0x${'ab'.repeat(32)}`,
    );
    expect(explorerCoin(`0x${'ab'.repeat(32)}`, 'testnet11')).toBe(
      `https://mempoolxch.space/coin/0x${'ab'.repeat(32)}?network=testnet11`,
    );
    expect(explorerAddress('txch1abc', 'testnet11')).toBe(
      'https://mempoolxch.space/address/txch1abc?network=testnet11',
    );
  });
});
