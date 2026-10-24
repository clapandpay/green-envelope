// SPDX-License-Identifier: AGPL-3.0-or-later
// The screens that are not on the claim route load on demand, in their own chunks.

export const loadCreateScreen = () => import('./create/CreateScreen').then((m) => m.CreateScreen);
export const loadHelloScreen = () => import('./hello/HelloScreen').then((m) => m.HelloRoute);
export const loadWalletScreen = () => import('./wallet/WalletScreen').then((m) => m.WalletScreen);

/** Fetches both chunks while the person is busy being happy; failures do not matter here. */
export function preloadScreens(): void {
  loadCreateScreen().catch(() => {});
  loadWalletScreen().catch(() => {});
}
