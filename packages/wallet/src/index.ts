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
  wipeUnlocked,
} from './keystore';
export { ENTROPY_BYTES, mnemonicFromEntropy, seedFromEntropy } from './mnemonic';
export {
  indexedDbStorage,
  type KeyStoreStorage,
  type StoredWallet,
  type WalletVersion,
} from './storage';
export {
  createVaultKeyStore,
  indexedDbVaultStorage,
  memoryVaultStorage,
  parseVaultRecord,
  type StoredVault,
  type VaultKeyStore,
  type VaultKeyStoreOptions,
  type VaultRecord,
  type VaultStorage,
} from './vault-keystore';
export { currentVault, findLauncherId, keyWithMoney, walletCoins } from './vault-state';
