/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which services the screens talk to. Default: `mock`. */
  readonly VITE_SERVICES?: 'mock' | 'real';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
