// SPDX-License-Identifier: AGPL-3.0-or-later

/** Why a wallet operation failed. */
export type WalletErrorCode =
  | 'cancelled' // the user dismissed the passkey prompt (or the browser refused to show it)
  | 'no_wallet' // unlock without a wallet on this device
  | 'exists' // create while a wallet exists; forget() it first, after moving the money
  | 'unsupported' // the passkey exists but this browser cannot evaluate PRF for it
  | 'corrupt' // the stored device wallet cannot be decrypted
  | 'insufficient_funds' // the wallet's coins do not cover the amount
  | 'storage'; // IndexedDB is unavailable or failed (private mode, blocked site data)

/** The only error type this package throws. */
export class WalletError extends Error {
  override readonly name = 'WalletError';
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message?: string, options?: ErrorOptions) {
    super(message === undefined ? code : `${code}: ${message}`, options);
    this.code = code;
  }
}
