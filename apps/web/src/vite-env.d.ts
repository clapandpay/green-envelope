// SPDX-License-Identifier: AGPL-3.0-or-later
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mainnet` or `testnet11`. Default: mainnet; `?net=` overrides it per link. */
  readonly VITE_NETWORK?: string;
  /** The mainnet site; default https://envelope.clapandpay.com */
  readonly VITE_MAINNET_URL?: string;
  /** The testnet site; default https://testnet.envelope.clapandpay.com */
  readonly VITE_TESTNET_URL?: string;
  /** Comma-separated Coinset-compatible base URLs, tried in order. */
  readonly VITE_CHAIN_ENDPOINTS?: string;
  /** Origin written into the links this app makes. Default: the origin of the page. */
  readonly VITE_PUBLIC_ORIGIN?: string;
  /** Fee added to each transaction, in mojos. Default: a floor on mainnet, 0 on testnet. */
  readonly VITE_FEE_MOJOS?: string;
  /** Handle registry base URL. Default: XCHandles on mainnet, none on a test chain. */
  readonly VITE_HANDLES_API?: string;
  /** Faucet endpoint for /hello (docs/faucet.md). Unset: /hello goes to the app's start. */
  readonly VITE_FAUCET_URL?: string;
  /** Comma-separated extra origins a faucet link may name. This page's own origin always may. */
  readonly VITE_FAUCET_ORIGINS?: string;
  /** Set by vite.config.ts: the release number, from green-envelope/package.json. */
  readonly APP_VERSION?: string;
  /** Set by vite.config.ts: the short commit the bundle was built from. */
  readonly APP_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
