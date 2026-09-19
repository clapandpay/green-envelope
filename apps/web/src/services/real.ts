// SPDX-License-Identifier: AGPL-3.0-or-later
// Placeholder for the services wired to @ge/wallet, @ge/envelope and @ge/chain.
// The integrator replaces the body; screens and tests do not change.
import type { AppServices } from './types';

/** The real services. Not wired yet. */
export function createRealServices(): AppServices {
  throw new Error('not wired yet');
}
