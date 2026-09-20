// SPDX-License-Identifier: AGPL-3.0-or-later
// Picks the services at build time: `VITE_SERVICES=real` or (default, for now) `mock`.
// The comparison is against a build-time constant, so the unused side is dropped from the bundle.
import { resolveNetwork } from '../lib/network';
import { createMockServices, parseMockFlags } from './mock';
import { createRealServices } from './real';
import type { AppServices } from './types';

/** The services for this build. */
export function createServices(): AppServices {
  if (import.meta.env.VITE_SERVICES === 'real') return createRealServices();
  return createMockServices({
    flags: parseMockFlags(location.search),
    origin: location.origin,
    network: resolveNetwork(location.search, import.meta.env.VITE_NETWORK),
  });
}
