import { isScenarioId, type ScenarioId } from './demo/fixtures';

// Client configuration: everything comes from Vite env vars (VITE_*) or the
// page URL. Nothing about the server (address, rules, timings) is hard-coded.

export interface DemoRequest {
  /** Scene to open right away (?demo=<cena>); null opens the lobby with demo tools. */
  readonly scenario: ScenarioId | null;
  /** ?jogadores=2..6 */
  readonly players: number | null;
  /** ?tempo=3 multiplies the demo durations (slow manual tests). */
  readonly timeScale: number | null;
}

export interface ClientConfig {
  /** VITE_SERVER_URL, or null when unset (local demo). */
  readonly serverUrl: string | null;
  /** Set when the URL asks for a demo (?demo=...). */
  readonly demo: DemoRequest | null;
  /** Demo panel available: dev builds, or any build opened with ?demo=... */
  readonly demoTools: boolean;
}

export interface EnvLike {
  readonly DEV: boolean;
  readonly VITE_SERVER_URL?: string;
}

function positiveNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function readConfig(env: EnvLike, search: string): ClientConfig {
  const url = env.VITE_SERVER_URL?.trim() ?? '';
  const params = new URLSearchParams(search);
  const demoParam = params.get('demo');
  const demo: DemoRequest | null =
    demoParam === null
      ? null
      : {
          scenario: isScenarioId(demoParam) ? demoParam : null,
          players: positiveNumber(params.get('jogadores')),
          timeScale: positiveNumber(params.get('tempo')),
        };
  return { serverUrl: url === '' ? null : url, demo, demoTools: env.DEV || demo !== null };
}
