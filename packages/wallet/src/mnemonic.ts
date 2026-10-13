// SPDX-License-Identifier: AGPL-3.0-or-later
// A version 2 wallet is a standard 24-word Chia wallet: the same words give the same keys here,
// in Sage, in Klimper and in any other Chia wallet.
import { entropyToMnemonic, mnemonicToSeed } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/** BIP-39 entropy of a 24-word wallet. */
export const ENTROPY_BYTES = 32;

/** The 24 recovery words of `entropy`, separated by single spaces. */
export function mnemonicFromEntropy(entropy: Uint8Array): string {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new RangeError(`entropy must be ${ENTROPY_BYTES} bytes, got ${entropy.length}`);
  }
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * The 64-byte BIP-39 seed of the words, with the empty passphrase. Sage imports a mnemonic as
 * `SecretKey::from_seed(&mnemonic.to_seed(""))`, and `keyGen` is `from_seed`, so this seed is
 * what `accountFromSeed` and `masterSecretKey` take for a version 2 wallet.
 */
export function seedFromEntropy(entropy: Uint8Array): Promise<Uint8Array> {
  return mnemonicToSeed(mnemonicFromEntropy(entropy), '');
}
