// SPDX-License-Identifier: AGPL-3.0-or-later
// @ge/passkey-signer: a passkey as a signer. Keys never leave the authenticator.
export type {
  Passkey,
  RelyingParty,
  Signed,
  SignerEnv,
  SignerErrorCode,
} from './signer';
export {
  browserSignerEnv,
  candidateKeys,
  createPasskey,
  findPasskey,
  narrowKey,
  SignerError,
  signChallenge,
} from './signer';
