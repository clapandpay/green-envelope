// SPDX-License-Identifier: AGPL-3.0-or-later
// There is one set of services and they are the real ones: a real chain, a real passkey, real
// money. No build flag and no query parameter can put anything else in their place, so the app
// on screen is always the app.
//
// Tests build these same services over a chain that lives in memory (`test/world.ts`). There is
// no second implementation of `AppServices` anywhere in this repository.
import { createRealServices } from './real';
import type { AppServices } from './types';

/** The services. */
export function createServices(): AppServices {
  return createRealServices();
}
