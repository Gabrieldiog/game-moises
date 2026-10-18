import { defineConfig } from 'vitest/config';

// Every workspace with its own vitest.config.ts is a Vitest project
// (shared/, server/; the web client joins automatically once client/vitest.config.ts exists).
export default defineConfig({
  test: {
    projects: ['*/vitest.config.ts'],
  },
});
