// SPDX-License-Identifier: AGPL-3.0-or-later
// @ge/vault: a CHIP-0043 vault whose custody is a passkey. No private key ever exists here.
export type { VaultErrorCode } from './errors';
export { VaultError } from './errors';
export {
  compressPublicKey,
  PUBLIC_KEY_BYTES,
  publicKeyFromSpki,
  recoverPublicKeys,
  SIGNATURE_BYTES,
  signatureFromDer,
  verifyPrehashed,
} from './p256';
export { custodyHash, moneyPuzzleHash, vaultPuzzleHash } from './puzzles';
export type { Assertion, Launch, LineageProof, Output, Unsigned, VaultCoin } from './vault';
export {
  buildSetupSpend,
  buildVaultSpend,
  HINT_TAG,
  launchVault,
  setupPuzzleHash,
  VAULT_AMOUNT,
  vaultHint,
} from './vault';
