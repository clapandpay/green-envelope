// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why a chain call failed; see `docs/contracts.md`. */
export type ChainErrorCode =
  | 'network' // endpoint unreachable or timed out on every endpoint
  | 'double_spend' // the coin is already spent or a conflicting spend is in the mempool
  | 'unknown_coin' // coin not found (not confirmed yet, or never existed)
  | 'rejected' // any other definitive rejection; `detail` has the node's error
  | 'bad_response';

/** The only error type this package throws for anything that happens on the wire. */
export class ChainError extends Error {
  override readonly name = 'ChainError';
  readonly code: ChainErrorCode;
  readonly detail?: string;

  constructor(code: ChainErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
