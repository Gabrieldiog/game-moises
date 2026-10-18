/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server address (Socket.IO). Empty = local demo match (mock). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
