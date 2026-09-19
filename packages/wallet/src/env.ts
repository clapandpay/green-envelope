// SPDX-License-Identifier: AGPL-3.0-or-later
// Every browser global the keystore touches, behind one injectable object so tests run in node.

/** The static methods of `PublicKeyCredential` used for feature detection. */
export interface PublicKeyCredentialStatics {
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  getClientCapabilities?: () => Promise<Record<string, boolean>>;
}

/** The browser capabilities the keystore needs. Absent members mean "not available here". */
export interface KeyStoreEnv {
  crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  credentials?: Pick<CredentialsContainer, 'create' | 'get'> | undefined;
  publicKeyCredential?: PublicKeyCredentialStatics | undefined;
  indexedDB?: IDBFactory | undefined;
}

/** The real environment, read from `globalThis` at call time (never at import time). */
export function browserEnv(): KeyStoreEnv {
  const g: {
    crypto: Crypto;
    navigator?: { credentials?: CredentialsContainer };
    PublicKeyCredential?: PublicKeyCredentialStatics;
    indexedDB?: IDBFactory;
  } = globalThis;
  return {
    crypto: g.crypto,
    credentials: g.navigator?.credentials,
    publicKeyCredential: g.PublicKeyCredential,
    indexedDB: g.indexedDB,
  };
}
