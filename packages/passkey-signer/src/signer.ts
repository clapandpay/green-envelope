// SPDX-License-Identifier: AGPL-3.0-or-later
// A passkey as a signer: it makes a P-256 key inside the authenticator and signs 32-byte
// challenges with it after a face, finger or PIN. That is all a page can ask of it. The
// private key never leaves the authenticator, nothing is derived from it (no PRF), and nothing
// secret is stored anywhere: what this module returns is public.
//
// App-neutral on purpose: Green Envelope is the first user, not the only one.
import type { Bytes } from '@ge/chia';
import { sha256 } from '@ge/chia';
import type { Assertion } from '@ge/vault';
import { publicKeyFromSpki, recoverPublicKeys, signatureFromDer } from '@ge/vault';

/** Why the passkey did not answer. */
export type SignerErrorCode =
  | 'cancelled' // the prompt was dismissed, or no passkey was picked
  | 'unsupported' // no WebAuthn here, or the authenticator cannot make an ES256 key
  | 'bad_response'; // the authenticator answered with something unusable

/** The only error type this package throws. */
export class SignerError extends Error {
  override readonly name = 'SignerError';
  readonly code: SignerErrorCode;

  constructor(code: SignerErrorCode, message?: string, options?: ErrorOptions) {
    super(message === undefined ? code : `${code}: ${message}`, options);
    this.code = code;
  }
}

/** The browser pieces this module uses, injectable for tests. */
export interface SignerEnv {
  crypto: Pick<Crypto, 'getRandomValues'>;
  credentials?: Pick<CredentialsContainer, 'create' | 'get'> | undefined;
}

/** The real browser, read at call time. */
export function browserSignerEnv(): SignerEnv {
  const g: { crypto: Crypto; navigator?: { credentials?: CredentialsContainer } } = globalThis;
  return { crypto: g.crypto, credentials: g.navigator?.credentials };
}

/** Which site the passkeys belong to; `rpId` undefined means the page's own host. */
export interface RelyingParty {
  rpId: string | undefined;
  rpName: string;
}

/** A passkey as the chain knows it: its id in the authenticator and its public key. */
export interface Passkey {
  credentialId: Bytes;
  /** 33-byte compressed P-256 public key. */
  publicKey: Bytes;
}

const ES256 = -7;

type Owned = Uint8Array<ArrayBuffer>;

function owned(bytes: Bytes): Owned {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function bytesOf(value: unknown): Bytes | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  return null;
}

function translate(cause: unknown): unknown {
  const name = typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : null;
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new SignerError('cancelled', 'the passkey prompt was dismissed', { cause });
  }
  if (name === 'NotSupportedError') {
    return new SignerError('unsupported', 'this authenticator cannot make the key', { cause });
  }
  return cause;
}

function needCredentials(env: SignerEnv): Pick<CredentialsContainer, 'create' | 'get'> {
  if (env.credentials === undefined) throw new SignerError('unsupported', 'no WebAuthn here');
  return env.credentials;
}

/**
 * Makes a discoverable ES256 passkey and returns its public key. One prompt. Only ES256: the
 * chain verifies P-256 (`secp256r1_verify`) and nothing else.
 */
export async function createPasskey(
  env: SignerEnv,
  rp: RelyingParty,
  label: string,
): Promise<Passkey> {
  const credentials = needCredentials(env);
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: rp.rpId === undefined ? { name: rp.rpName } : { id: rp.rpId, name: rp.rpName },
    user: { id: env.crypto.getRandomValues(new Uint8Array(32)), name: label, displayName: label },
    challenge: env.crypto.getRandomValues(new Uint8Array(32)), // nothing to prove to anyone
    pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    attestation: 'none',
  };
  let credential: Credential | null;
  try {
    credential = await credentials.create({ publicKey });
  } catch (cause) {
    throw translate(cause);
  }
  if (credential === null || !('rawId' in credential) || !('response' in credential)) {
    throw new SignerError('bad_response', 'no credential');
  }
  const response = credential.response as Partial<AuthenticatorAttestationResponse>;
  if (typeof response.getPublicKey !== 'function') {
    throw new SignerError('unsupported', 'this browser does not hand out the public key');
  }
  if (response.getPublicKeyAlgorithm?.() !== ES256) {
    throw new SignerError('unsupported', 'the passkey is not an ES256 key');
  }
  const spki = bytesOf(response.getPublicKey());
  const id = bytesOf(credential.rawId);
  if (spki === null || id === null) throw new SignerError('bad_response', 'no public key');
  return { credentialId: id, publicKey: publicKeyFromSpki(spki) };
}

/** A signature over `challenge` and the passkey that made it. */
export interface Signed {
  credentialId: Bytes;
  assertion: Assertion;
}

/**
 * Asks a passkey to sign `challenge` (32 bytes, which the browser writes into clientDataJSON
 * as base64url, exactly what the chain checks). With `credentialId` it must be that passkey;
 * with `null` the phone offers every passkey it has for this site. One prompt.
 */
export async function signChallenge(
  env: SignerEnv,
  rp: RelyingParty,
  challenge: Bytes,
  credentialId: Bytes | null,
): Promise<Signed> {
  const credentials = needCredentials(env);
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: owned(challenge),
    allowCredentials:
      credentialId === null ? [] : [{ type: 'public-key', id: owned(credentialId) }],
    userVerification: 'required',
  };
  if (rp.rpId !== undefined) publicKey.rpId = rp.rpId;
  let credential: Credential | null;
  try {
    credential = await credentials.get({ publicKey });
  } catch (cause) {
    throw translate(cause);
  }
  if (credential === null || !('rawId' in credential) || !('response' in credential)) {
    throw new SignerError('cancelled', 'no passkey was picked');
  }
  const response = credential.response as Partial<AuthenticatorAssertionResponse>;
  const authenticatorData = bytesOf(response.authenticatorData);
  const clientDataJSON = bytesOf(response.clientDataJSON);
  const der = bytesOf(response.signature);
  const id = bytesOf(credential.rawId);
  if (authenticatorData === null || clientDataJSON === null || der === null || id === null) {
    throw new SignerError('bad_response', 'an incomplete answer');
  }
  return {
    credentialId: id,
    assertion: { authenticatorData, clientDataJSON, signature: signatureFromDer(der) },
  };
}

/** What a signature says about the key that made it: at most two candidate public keys. */
export function candidateKeys(assertion: Assertion): Bytes[] {
  const signed = sha256(assertion.authenticatorData, sha256(assertion.clientDataJSON));
  return recoverPublicKeys(signed, assertion.signature);
}

/**
 * Finds a passkey that already exists (another browser, a new phone): one prompt over a
 * random challenge. WebAuthn gives the public key out only when a passkey is made, so it is
 * recovered from the signature: two candidates, which the caller tells apart by asking the
 * chain, or with `narrowKey` when the chain cannot tell.
 */
export async function findPasskey(
  env: SignerEnv,
  rp: RelyingParty,
): Promise<{ credentialId: Bytes; candidates: Bytes[] }> {
  const challenge = env.crypto.getRandomValues(new Uint8Array(32));
  const { credentialId, assertion } = await signChallenge(env, rp, challenge, null);
  return { credentialId, candidates: candidateKeys(assertion) };
}

/** A second signature by the same passkey settles which candidate is its key. One prompt. */
export async function narrowKey(
  env: SignerEnv,
  rp: RelyingParty,
  credentialId: Bytes,
  candidates: Bytes[],
): Promise<Bytes> {
  const challenge = env.crypto.getRandomValues(new Uint8Array(32));
  const { assertion } = await signChallenge(env, rp, challenge, credentialId);
  const again = candidateKeys(assertion).map((key) => key.join(','));
  const both = candidates.filter((key) => again.includes(key.join(',')));
  const [key] = both;
  if (key === undefined || both.length !== 1) {
    throw new SignerError('bad_response', 'the two signatures do not agree on one key');
  }
  return key;
}
