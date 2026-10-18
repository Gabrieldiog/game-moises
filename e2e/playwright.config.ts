import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Ports: asked from the OS once, in the main process. Workers inherit the
// environment, so they see the same values (the config is evaluated again there).
function freePort(): number {
  const script =
    "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  const out = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return Number(out.stdout.trim());
}

function port(name: string): number {
  const fromEnv = process.env[name];
  if (fromEnv) return Number(fromEnv);
  const chosen = freePort();
  process.env[name] = String(chosen);
  return chosen;
}

const serverPort = port('E2E_SERVER_PORT');
const clientPort = port('E2E_CLIENT_PORT');
const serverUrl = `http://127.0.0.1:${serverPort}`;
const clientUrl = `http://127.0.0.1:${clientPort}`;
process.env['E2E_BASE_URL'] = clientUrl;

// Local sandboxes ship a Chromium under /opt/pw-browsers (never installed from here).
// In CI the browser comes from `npx playwright install --with-deps chromium`.
function localChromium(): string | undefined {
  if (process.env['E2E_CHROMIUM']) return process.env['E2E_CHROMIUM'];
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
  const exe = dir ? join(root, dir, 'chrome-linux', 'chrome') : '';
  return exe && existsSync(exe) ? exe : undefined;
}
const executablePath = localChromium();

// Short timings so a whole game fits in seconds (the server validates and clamps them).
const serverEnv: Record<string, string> = {
  PORT: String(serverPort),
  HOST: '127.0.0.1',
  CORS_ORIGIN: clientUrl,
  LOG_LEVEL: 'silent',
  MAX_ROOMS_PER_IP: '100',
  MAX_CONNECTIONS_PER_IP: '100',
  BOT_DELAY_MIN_MS: '50',
  BOT_DELAY_MAX_MS: '150',
  MOISES_ARRANGE_MS: '600',
  MOISES_INITIAL_PEEK_MS: '600',
  MOISES_REACTION_WINDOW_MS: '700',
  MOISES_REVEAL_MS: '500',
  MOISES_TURN_MS: '5000',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: clientUrl,
    viewport: { width: 390, height: 844 },
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: [
    {
      command: 'npm run dev -w server',
      cwd: '..',
      url: `${serverUrl}/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -w client -- --host 127.0.0.1 --port ${clientPort} --strictPort`,
      cwd: '..',
      url: clientUrl,
      env: { VITE_SERVER_URL: serverUrl },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
