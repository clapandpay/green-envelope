/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mainnet` or `testnet11`. Default: mainnet; `?net=` overrides it per link. */
  readonly VITE_NETWORK?: string;
  /** Comma-separated Coinset-compatible base URLs, tried in order. */
  readonly VITE_CHAIN_ENDPOINTS?: string;
  /** Origin written into the links this app makes. Default: the origin of the page. */
  readonly VITE_PUBLIC_ORIGIN?: string;
  /** Fee added to each transaction, in mojos. Default: 0. */
  readonly VITE_FEE_MOJOS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
