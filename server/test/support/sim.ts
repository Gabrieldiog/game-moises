import { DEFAULT_RULES, type RulesConfig } from '../../src/config/rules.js';
import { GameSession, type SessionPlayer } from '../../src/game/session.js';
import type { ServerGameEvent } from '@moises/shared';
import type { BotTuning } from '../../src/bots/index.js';

/** Small deterministic PRNG for tests (mulberry32). Not for anything secret. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  /** Seats; isBot false = a passive seat that never acts (covered by the turn timer). */
  players: SessionPlayer[];
  seed: number;
  rules?: RulesConfig;
  botDelayMs?: { min: number; max: number };
  botTuning?: BotTuning;
  maxWakeUps?: number;
  /** Receives the public events after every wake-up. */
  onEvents?: (events: readonly ServerGameEvent[]) => void;
}

export interface SimResult {
  session: GameSession;
  wakeUps: number;
  endTime: number;
}

/** Plays a whole game in virtual time: jump to each wake-up and advance. */
export function simulate(options: SimOptions): SimResult {
  const start = 1_000_000;
  const session = new GameSession({
    players: options.players,
    rules: options.rules ?? DEFAULT_RULES,
    seed: `sim-seed-${options.seed}-padding-xx`,
    now: start,
    random: seededRandom(options.seed),
    botDelayMs: options.botDelayMs ?? { min: 0, max: 0 },
    ...(options.botTuning ? { botTuning: options.botTuning } : {}),
  });
  let now = start;
  let wakeUps = 0;
  const max = options.maxWakeUps ?? 100_000;
  while (session.phase !== 'ended') {
    const at = session.nextWakeAt();
    if (at === null) throw new Error('simulate: game is stuck (nothing scheduled)');
    now = Math.max(now, at);
    session.advance(now);
    const events = session.drainEvents();
    options.onEvents?.(events);
    if (++wakeUps > max) throw new Error('simulate: too many wake-ups');
  }
  return { session, wakeUps, endTime: now };
}

export function bots(count: number): SessionPlayer[] {
  return Array.from({ length: count }, (_, i) => ({ id: `b${i + 1}`, name: `Bot ${i + 1}`, isBot: true }));
}
