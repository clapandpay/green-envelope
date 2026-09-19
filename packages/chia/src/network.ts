// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bytes } from './bytes';
import { fromHex } from './bytes';

/** A Chia network: its address prefix and the extra data mixed into every AGG_SIG_ME message. */
export interface Network {
  name: 'mainnet' | 'testnet11';
  addressPrefix: 'xch' | 'txch';
  aggSigMeExtraData: Bytes; // genesis challenge
}

/** Chia mainnet. */
export const MAINNET: Network = {
  name: 'mainnet',
  addressPrefix: 'xch',
  aggSigMeExtraData: /* @__PURE__ */ fromHex(
    'ccd5bb71183532bff220ba46c268991a3ff07eb358e8255a65c30a2dce0e5fbb',
  ),
};

/** Chia testnet11. */
export const TESTNET11: Network = {
  name: 'testnet11',
  addressPrefix: 'txch',
  aggSigMeExtraData: /* @__PURE__ */ fromHex(
    '37a90eb5185a9c4439a91ddc98bbadce7b4feba060d50116a067de66bf236615',
  ),
};
