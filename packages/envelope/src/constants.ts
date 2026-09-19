// SPDX-License-Identifier: AGPL-3.0-or-later

/** The most shares one envelope can have; also one batched coin lookup in `@ge/chain`. */
export const MAX_SHARES = 100;
/** Length of the link secret in bytes (128 bits). */
export const SECRET_BYTES = 16;
/** Length of the envelope public key in the link path (compressed BLS G1). */
export const PUBLIC_KEY_BYTES = 48;
/** Longest sender name kept from a link, in Unicode code points after trimming. */
export const MAX_FROM_CHARS = 40;
/** Longest message kept from a link, in Unicode code points after trimming. */
export const MAX_MESSAGE_CHARS = 120;
/**
 * Default smallest share in mojos. It only keeps a share from being empty dust; it is not an
 * economic minimum. The app should pass a floor that covers the claim fee taken out of a share.
 */
export const DEFAULT_FLOOR = 1000n;
