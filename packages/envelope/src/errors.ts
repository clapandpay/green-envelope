// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why an envelope operation was refused. */
export type EnvelopeErrorCode =
  | 'bad_link' // not an envelope link, or its key or secret has the wrong length
  | 'bad_secret' // the secret is not SECRET_BYTES long
  | 'bad_shares' // shares is not an integer in 1..MAX_SHARES
  | 'bad_floor' // floor is below one mojo
  | 'amount_too_small' // total cannot give every share the floor
  | 'bad_random' // the injected random() left [0, 1)
  | 'bad_amount' // an amount is not positive, or the fee leaves nothing
  | 'insufficient_funds' // the inputs do not cover amounts plus fee
  | 'nothing_to_take_back' // no unopened share is left
  | 'not_found' // no share exists on chain (yet): the creating transaction is unconfirmed, or the link is wrong
  | 'envelope_empty' // every share is opened
  | 'lost_race' // somebody else's claim of the same share won
  | 'timeout'; // the network did not confirm in time

/** The only error type this package throws. */
export class EnvelopeError extends Error {
  override readonly name = 'EnvelopeError';
  readonly code: EnvelopeErrorCode;

  constructor(code: EnvelopeErrorCode, message?: string) {
    super(message === undefined ? code : `${code}: ${message}`);
    this.code = code;
  }
}
