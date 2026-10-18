/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server address (Socket.IO). URL = that server; empty or "same-origin" = the page's own origin (production); empty in dev = local demo (mock). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
