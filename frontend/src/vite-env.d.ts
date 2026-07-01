/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCAL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
