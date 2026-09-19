// SPDX-License-Identifier: AGPL-3.0-or-later

/** Machine-readable reason carried by every error this package throws. */
export type ChiaErrorCode =
  | 'bad_hex'
  | 'bad_base64url'
  | 'bad_length'
  | 'bad_int'
  | 'bad_key'
  | 'bad_signature'
  | 'bad_address'
  | 'bad_clvm'
  | 'wrong_puzzle_hash'
  | 'amount_out_of_range';

/** The one error type of `@ge/chia`; `code` says what went wrong. */
export class ChiaError extends Error {
  readonly code: ChiaErrorCode;

  constructor(code: ChiaErrorCode, message: string) {
    super(message);
    this.name = 'ChiaError';
    this.code = code;
  }
}
