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
  /** Resolved server address, or null for the local demo (mock). */
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

/** VITE_SERVER_URL value meaning "the server that delivered this page". */
export const SAME_ORIGIN = 'same-origin';

/**
 * Server address resolution:
 * - VITE_SERVER_URL set to a URL: that URL;
 * - "same-origin": the page's own origin (any build);
 * - empty: production build -> the page's own origin (the server serves the
 *   client); dev build -> null (local demo, no server).
 */
export function resolveServerUrl(env: EnvLike, origin: string | null): string | null {
  const raw = env.VITE_SERVER_URL?.trim() ?? '';
  if (raw === SAME_ORIGIN || (raw === '' && !env.DEV)) {
    return origin !== null && origin !== '' && origin !== 'null' ? origin : null;
  }
  return raw === '' ? null : raw;
}

export function readConfig(env: EnvLike, search: string, origin: string | null = null): ClientConfig {
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
  return { serverUrl: resolveServerUrl(env, origin), demo, demoTools: env.DEV || demo !== null };
}
