/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
