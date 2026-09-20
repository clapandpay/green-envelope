// SPDX-License-Identifier: AGPL-3.0-or-later
// Passkey wallet: the WebAuthn PRF extension turns a biometric prompt into 32 stable secret bytes.
import type { KeyStoreEnv } from './env';
import { WalletError } from './errors';
import type { OwnedBytes } from './storage';

const utf8 = (text: string): OwnedBytes => new TextEncoder().encode(text);

/** The PRF input is sha256 of this tag. Changing it changes every passkey wallet's address. */
export const PRF_SALT_TAG = 'clapandpay:wallet:v1';
/** HKDF `info` that separates the wallet seed from any other use of the same PRF output. */
export const SEED_INFO_TAG = 'clapandpay:wallet:v1:seed';

const ES256 = -7;
const RS256 = -257;
const PRF_BYTES = 32;

/** Relying-party settings; `rpId` undefined lets the browser use the page's own domain. */
export interface RelyingParty {
  rpId: string | undefined;
  rpName: string;
}

/** Result of asking the authenticator: a seed, or the fact that it cannot do PRF. */
export type PrfOutcome = { seed: OwnedBytes } | { seed: null };

async function prfSalt(env: KeyStoreEnv): Promise<OwnedBytes> {
  return new Uint8Array(await env.crypto.subtle.digest('SHA-256', utf8(PRF_SALT_TAG)));
}

/**
 * seed = HKDF-SHA256(ikm = PRF output, salt = empty, info = SEED_INFO_TAG), 32 bytes.
 * The raw PRF output is never used as a key, so another feature can use the same passkey
 * with another `info` without ever learning the wallet seed. The PRF buffer is wiped after use.
 */
export async function seedFromPrf(env: KeyStoreEnv, prf: OwnedBytes): Promise<OwnedBytes> {
  const { subtle } = env.crypto;
  try {
    const ikm = await subtle.importKey('raw', prf, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(SEED_INFO_TAG) },
      ikm,
      256,
    );
    return new Uint8Array(bits);
  } finally {
    prf.fill(0);
  }
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
  if (env.credentials === undefined) return { seed: null, credentialId: null };
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
  if (parsed === null) return { seed: null, credentialId: null };
  const used = new Uint8Array(parsed.rawId.slice(0));
  const prf = prfOutput(parsed);
  return prf === null
    ? { seed: null, credentialId: used }
    : { seed: await seedFromPrf(env, prf), credentialId: used };
}

/** Creates a discoverable passkey and evaluates PRF, with a second prompt only if create gave no PRF result. */
export async function createPasskeyWallet(
  env: KeyStoreEnv,
  rp: RelyingParty,
): Promise<PrfOutcome & { credentialId: OwnedBytes | null }> {
  if (env.credentials === undefined) return { seed: null, credentialId: null };
  const label = `${rp.rpName} wallet`;
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
  if (parsed === null) return { seed: null, credentialId: null };
  const credentialId = new Uint8Array(parsed.rawId.slice(0));
  const prf = prfOutput(parsed);
  if (prf !== null) return { seed: await seedFromPrf(env, prf), credentialId };
  // Most authenticators only evaluate PRF on get(). `enabled: false` says it never will.
  if (parsed.getClientExtensionResults().prf?.enabled === false)
    return { seed: null, credentialId };
  return { seed: (await assertPrf(env, rp, credentialId)).seed, credentialId };
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
