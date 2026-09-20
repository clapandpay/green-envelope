// SPDX-License-Identifier: AGPL-3.0-or-later
export {
  type Account,
  accountFromSeed,
  envelopeSecret,
  MAX_INPUTS,
  masterSecretKey,
  selectCoins,
} from './account';
export type { KeyStoreEnv, PublicKeyCredentialStatics } from './env';
export { WalletError, type WalletErrorCode } from './errors';
export {
  createKeyStore,
  type KeyStore,
  type KeyStoreOptions,
  type UnlockedWallet,
  type WalletKind,
} from './keystore';
export { indexedDbStorage, type KeyStoreStorage, type StoredWallet } from './storage';
