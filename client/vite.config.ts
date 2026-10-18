import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No server URL or port lives here: the game server address comes from
// VITE_SERVER_URL (see .env.example). Vite's own dev port is its default.
export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
});
