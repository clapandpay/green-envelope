// SPDX-License-Identifier: AGPL-3.0-or-later
// Links to mempoolxch.space, the block explorer where anyone can see where money went: a coin
// (`/coin/0x…`) or an address (`/address/xch1…`). Testnet pages carry `?network=testnet11`.

import type { NetworkName } from './network';

/** The explorer's base URL. */
export const EXPLORER = 'https://mempoolxch.space';

function onNetwork(path: string, network: NetworkName): string {
  return network === 'mainnet' ? `${EXPLORER}${path}` : `${EXPLORER}${path}?network=${network}`;
}

/** The page of one coin: where exactly a payment landed. `coinId` is hex, with or without 0x. Pure. */
export function explorerCoin(coinId: string, network: NetworkName): string {
  return onNetwork(`/coin/0x${coinId.replace(/^0x/, '')}`, network);
}

/** The page of an address: everything it ever received. Pure. */
export function explorerAddress(address: string, network: NetworkName): string {
  return onNetwork(`/address/${encodeURIComponent(address)}`, network);
}
