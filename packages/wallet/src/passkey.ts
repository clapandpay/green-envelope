// SPDX-License-Identifier: AGPL-3.0-or-later
// Passkey wallet: the WebAuthn PRF extension turns a biometric prompt into 32 stable secret bytes.
import type { KeyStoreEnv } from './env';
import { WalletError } from './errors';
import type { OwnedBytes } from './storage';

const utf8 = (text: string): OwnedBytes => new TextEncoder().encode(text);

/** The PRF input is sha256 of this tag. Changing it changes every passkey wallet's address. */
export const PRF_SALT_TAG = 'clapandpay:wallet:v1';
/**
 * HKDF `info` of a version 1 wallet's seed: fed straight into BLS `KeyGen`, so it has no
 * recovery words. Still derived, so a version 1 wallet's money can be found and moved
 * (TASK-128).
 */
export const SEED_INFO_TAG = 'clapandpay:wallet:v1:seed';
/**
 * HKDF `info` of a version 2 wallet's BIP-39 entropy: the passkey's 24 recovery words
 * (`mnemonic.ts`). Changing it changes every version 2 wallet.
 */
export const MNEMONIC_INFO_TAG = 'clapandpay:mnemonic:v2';
/**
 * HKDF `info` for the key that wraps a seed this passkey did not make.
 *
 * A passkey wallet's own seed is derived from the PRF and never stored, which is why there is
 * nothing secret in its record. A seed that came from somewhere else — an existing wallet a
 * person is bringing with them, or a device wallet being put behind a face — cannot be derived,
 * so it is encrypted under this second key and kept. Different `info`, same passkey: holding
 * one key tells you nothing about the other.
 */
export const WRAP_INFO_TAG = 'clapandpay:wallet:v1:wrap';

const ES256 = -7;
const RS256 = -257;
const PRF_BYTES = 32;

/** Relying-party settings; `rpId` undefined lets the browser use the page's own domain. */
export interface RelyingParty {
  rpId: string | undefined;
  rpName: string;
}

/**
 * Result of asking the authenticator: what one PRF evaluation yields, or the fact that this
 * authenticator cannot do PRF at all.
 */
export type PrfOutcome =
  | { seed: OwnedBytes; entropy: OwnedBytes; wrapKey: CryptoKey }
  | { seed: null; entropy: null; wrapKey: null };

const NO_PRF = { seed: null, entropy: null, wrapKey: null } as const;

async function prfSalt(env: KeyStoreEnv): Promise<OwnedBytes> {
  return new Uint8Array(await env.crypto.subtle.digest('SHA-256', utf8(PRF_SALT_TAG)));
}

const HKDF = (info: string) =>
  ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }) as const;

/**
 * Everything one PRF evaluation yields:
 *
 *   seed    = HKDF-SHA256(ikm = PRF output, info = SEED_INFO_TAG), 32 bytes (version 1)
 *   entropy = HKDF-SHA256(ikm = PRF output, info = MNEMONIC_INFO_TAG), 32 bytes (version 2)
 *   wrapKey = HKDF-SHA256(ikm = PRF output, info = WRAP_INFO_TAG) as a non-extractable AES-GCM key
 *
 * The raw PRF output is never used as a key and is wiped here, once, however this returns. All
 * are derived together because the authenticator is asked only once: a second prompt to get
 * another key would be a second face or finger for one tap. Callers wipe what they do not use.
 */
export async function keysFromPrf(
  env: KeyStoreEnv,
  prf: OwnedBytes,
): Promise<{ seed: OwnedBytes; entropy: OwnedBytes; wrapKey: CryptoKey }> {
  const { subtle } = env.crypto;
  try {
    const ikm = await subtle.importKey('raw', prf, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const bits = await subtle.deriveBits(HKDF(SEED_INFO_TAG), ikm, 256);
    const entropy = await subtle.deriveBits(HKDF(MNEMONIC_INFO_TAG), ikm, 256);
    // extractable = false: this key can wrap and unwrap a seed, but its own bytes never exist.
    const wrapKey = await subtle.deriveKey(
      HKDF(WRAP_INFO_TAG),
      ikm,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return { seed: new Uint8Array(bits), entropy: new Uint8Array(entropy), wrapKey };
  } finally {
    prf.fill(0);
  }
}

/** The version 1 seed this passkey derives. Wipes `prf`. */
export async function seedFromPrf(env: KeyStoreEnv, prf: OwnedBytes): Promise<OwnedBytes> {
  const keys = await keysFromPrf(env, prf);
  keys.entropy.fill(0);
  return keys.seed;
}

/** The version 2 entropy (the 24 words) this passkey derives. Wipes `prf`. */
export async function entropyFromPrf(env: KeyStoreEnv, prf: OwnedBytes): Promise<OwnedBytes> {
  const keys = await keysFromPrf(env, prf);
  keys.seed.fill(0);
  return keys.entropy;
}

function toOwnedBytes(source: unknown): OwnedBytes | null {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy;
  }
  return null;
}

/** A credential as returned by WebAuthn, reduced to what the keystore reads. */
interface PrfCredential {
  rawId: ArrayBuffer;
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
}

function asPrfCredential(credential: Credential | null): PrfCredential | null {
  if (credential === null || !('rawId' in credential)) return null;
  if (!('getClientExtensionResults' in credential)) return null;
  const { rawId, getClientExtensionResults } = credential;
  if (!(rawId instanceof ArrayBuffer) || typeof getClientExtensionResults !== 'function')
    return null;
  return {
    rawId,
    getClientExtensionResults: () => getClientExtensionResults.call(credential),
  };
}

function prfOutput(credential: PrfCredential): OwnedBytes | null {
  const first = toOwnedBytes(credential.getClientExtensionResults().prf?.results?.first);
  return first !== null && first.length === PRF_BYTES ? first : null;
}

/** Maps a WebAuthn failure: a dismissed prompt is 'cancelled'; anything else is returned as is. */
function translate(cause: unknown): unknown {
  const name = typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : null;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new WalletError('cancelled', 'the passkey prompt was dismissed', { cause });
  }
  return cause;
}

/**
 * Asks for a passkey and evaluates PRF. With `credentialId` it must be that passkey; with `null`
 * the phone offers whichever passkeys it has for this site (they are discoverable), which is how
 * a wallet made in one browser is found again in another, or on a new phone.
 */
async function assertPrf(
  env: KeyStoreEnv,
  rp: RelyingParty,
  credentialId: OwnedBytes | null,
): Promise<PrfOutcome & { credentialId: OwnedBytes | null }> {
  if (env.credentials === undefined) return { ...NO_PRF, credentialId: null };
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: env.crypto.getRandomValues(new Uint8Array(32)), // nobody verifies it: no server
    allowCredentials: credentialId === null ? [] : [{ type: 'public-key', id: credentialId }],
    userVerification: 'required',
    extensions: { prf: { eval: { first: await prfSalt(env) } } },
  };
  if (rp.rpId !== undefined) publicKey.rpId = rp.rpId;
  let credential: Credential | null;
  try {
    credential = await env.credentials.get({ publicKey });
  } catch (cause) {
    throw translate(cause);
  }
  const parsed = asPrfCredential(credential);
  if (parsed === null) return { ...NO_PRF, credentialId: null };
  const used = new Uint8Array(parsed.rawId.slice(0));
  const prf = prfOutput(parsed);
  return prf === null
    ? { ...NO_PRF, credentialId: used }
    : { ...(await keysFromPrf(env, prf)), credentialId: used };
}

/** Creates a discoverable passkey and evaluates PRF, with a second prompt only if create gave no PRF result. */
export async function createPasskeyWallet(
  env: KeyStoreEnv,
  rp: RelyingParty,
  label = `${rp.rpName} wallet`,
): Promise<PrfOutcome & { credentialId: OwnedBytes | null }> {
  if (env.credentials === undefined) return { ...NO_PRF, credentialId: null };
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: rp.rpId === undefined ? { name: rp.rpName } : { id: rp.rpId, name: rp.rpName },
    user: { id: env.crypto.getRandomValues(new Uint8Array(32)), name: label, displayName: label },
    challenge: env.crypto.getRandomValues(new Uint8Array(32)), // nobody verifies it: no server
    pubKeyCredParams: [
      { type: 'public-key', alg: ES256 },
      { type: 'public-key', alg: RS256 },
    ],
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    attestation: 'none',
    extensions: { prf: { eval: { first: await prfSalt(env) } } },
  };
  let credential: Credential | null;
  try {
    credential = await env.credentials.create({ publicKey });
  } catch (cause) {
    throw translate(cause);
  }
  const parsed = asPrfCredential(credential);
  if (parsed === null) return { ...NO_PRF, credentialId: null };
  const credentialId = new Uint8Array(parsed.rawId.slice(0));
  const prf = prfOutput(parsed);
  if (prf !== null) return { ...(await keysFromPrf(env, prf)), credentialId };
  // Most authenticators only evaluate PRF on get(). `enabled: false` says it never will.
  // 1Password and Apple Passwords are both in the "only on get" group, so the second prompt
  // below is the normal path for them, not an error case.
  if (parsed.getClientExtensionResults().prf?.enabled === false) return { ...NO_PRF, credentialId };
  const second = await assertPrf(env, rp, credentialId);
  return { ...second, credentialId };
}

/** Prompts for the stored passkey and returns its seed, or `seed: null` when PRF is unavailable here. */
export function unlockPasskeyWallet(
  env: KeyStoreEnv,
  rp: RelyingParty,
  credentialId: OwnedBytes,
): Promise<PrfOutcome> {
  return assertPrf(env, rp, credentialId);
}

/** Lets the person pick one of their existing passkeys for this site and returns its seed. */
export function findPasskeyWallet(
  env: KeyStoreEnv,
  rp: RelyingParty,
): Promise<PrfOutcome & { credentialId: OwnedBytes | null }> {
  return assertPrf(env, rp, null);
}
