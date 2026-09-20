// SPDX-License-Identifier: AGPL-3.0-or-later
// Picks the services at build time. Real unless a demo is asked for with `VITE_SERVICES=mock`:
// a build that says nothing is a build that handles real money, because the opposite default
// once meant a release could quietly ship the demo. `pnpm dev` asks for the mock in
// apps/web/.env.development.
// The comparison is against a build-time constant, so the unused side is dropped from the bundle.
import { createKeyStore } from '@ge/wallet';
import { resolveNetwork } from '../lib/network';
import { createMockServices, parseMockFlags } from './mock';
import { createRealServices } from './real';
import type { AppServices } from './types';

/** The services for this build. */
export function createServices(): AppServices {
  if (import.meta.env.VITE_SERVICES !== 'mock') return createRealServices();
  return createMockServices({
    flags: parseMockFlags(location.search),
    origin: location.origin,
    network: resolveNetwork(location.search, import.meta.env.VITE_NETWORK),
    // The demo invents the money, not the way in: tapping the envelope makes a real passkey
    // and a real address, so the one part a person has to trust is the part they can try.
    // Tests leave this out and get the invented wallet instead.
    keyStore: createKeyStore({ rpName: 'Clap and Pay' }),
  });
}
