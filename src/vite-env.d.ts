/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIGITRANSIT_KEY?: string;
  readonly VITE_MAPTILER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}