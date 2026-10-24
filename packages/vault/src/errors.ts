// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why a vault operation failed. */
export type VaultErrorCode =
  | 'bad_key' // not a P-256 public key
  | 'bad_signature' // not a P-256 signature
  | 'bad_assertion' // the passkey's answer does not sign the challenge it was given
  | 'no_coins' // nothing to spend
  | 'insufficient_funds' // the coins do not cover the outputs and the fee
  | 'wrong_coin'; // a coin that is not the vault's, or not at its address

/** The only error type this package throws. */
export class VaultError extends Error {
  override readonly name = 'VaultError';
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message?: string, options?: ErrorOptions) {
    super(message === undefined ? code : `${code}: ${message}`, options);
    this.code = code;
  }
}
