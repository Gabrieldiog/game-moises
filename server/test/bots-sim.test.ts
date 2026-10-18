import { describe, expect, it } from 'vitest';
import type { ServerGameEvent } from '@moises/shared';
import { DEFAULT_RULES, parseRules } from '../src/config/rules.js';
import { bots, simulate } from './support/sim.js';

// Whole games played by bots in virtual time, through the same GameSession the
// server uses (engine + turn timer + bots). Every bot move goes through the
// engine's validation; a refused move is counted in stats.botRejected.

const SEEDS_PER_SIZE = 60;

interface Tally {
  games: number;
  turns: number;
  wrongReactions: number;
  rightReactions: number;
  powersUsed: number;
  swaps: number;
  ends: Map<string, number>;
}

function tally(): Tally {
  return { games: 0, turns: 0, wrongReactions: 0, rightReactions: 0, powersUsed: 0, swaps: 0, ends: new Map() };
}

function count(t: Tally, events: readonly ServerGameEvent[]): void {
  for (const e of events) {
    if (e.type === 'reactionFailed') t.wrongReactions += 1;
    if (e.type === 'reactionSucceeded') t.rightReactions += 1;
    if (e.type === 'powerUsed') t.powersUsed += 1;
    if (e.type === 'drawnCardSwapped' || e.type === 'powerSwapped') t.swaps += 1;
    if (e.type === 'endCalled') t.ends.set(e.reason, (t.ends.get(e.reason) ?? 0) + 1);
  }
}

describe('bot x bot games', () => {
  it.each([2, 3, 4, 5, 6])(
    `${SEEDS_PER_SIZE} games with %i bots all finish without a refused move`,
    (size) => {
      const t = tally();
      for (let seed = 1; seed <= SEEDS_PER_SIZE; seed++) {
        const { session } = simulate({ players: bots(size), seed: seed * 1000 + size, onEvents: (e) => count(t, e) });
        t.games += 1;
        t.turns += session.internalState.turnCount;
        expect(session.phase).toBe('ended');
        expect(session.result?.winners.length).toBeGreaterThan(0);
        expect(session.stats.botRejected).toBe(0);
        expect(session.stats.timeouts).toBe(0); // bots never leave the turn timer to play for them
      }
      // Bots remember exactly what they saw, so they never react wrongly.
      expect(t.wrongReactions).toBe(0);
      expect(t.rightReactions).toBeGreaterThan(0);
      expect(t.powersUsed).toBeGreaterThan(0);
      expect(t.swaps).toBeGreaterThan(0);
      expect(t.ends.get('called') ?? 0).toBeGreaterThan(0);
      expect(t.turns / t.games).toBeLessThan(200);
    },
    60_000,
  );

  it('is deterministic for a given seed', () => {
    const a = simulate({ players: bots(4), seed: 42 }).session;
    const b = simulate({ players: bots(4), seed: 42 }).session;
    expect(a.result).toEqual(b.result);
    expect(a.internalState).toEqual(b.internalState);
  });

  it('beats a seat that never plays (covered by the turn timer) almost always', () => {
    let botWins = 0;
    const games = 100;
    for (let seed = 1; seed <= games; seed++) {
      const { session } = simulate({
        players: [
          { id: 'bot', name: 'Bot', isBot: true },
          { id: 'afk', name: 'AFK', isBot: false },
        ],
        seed,
      });
      const scores = new Map(session.result?.scores.map((s) => [s.playerId, s.total]));
      if ((scores.get('bot') ?? 99) < (scores.get('afk') ?? -99)) botWins += 1;
      expect(session.stats.timeouts).toBeGreaterThan(0);
      expect(session.stats.botRejected).toBe(0);
    }
    expect(botWins).toBeGreaterThanOrEqual(90);
  }, 60_000);

  it('plays with natural delays and an absent human, and still finishes', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { session, endTime } = simulate({
        players: [...bots(3), { id: 'afk', name: 'AFK', isBot: false }],
        seed,
        botDelayMs: { min: 600, max: 1400 },
      });
      expect(session.phase).toBe('ended');
      expect(session.stats.botRejected).toBe(0);
      expect(endTime).toBeGreaterThan(0);
    }
  }, 60_000);

  it('adapts to other rules (bigger grid, black K sees three cards)', () => {
    const rules = parseRules({
      ...DEFAULT_RULES,
      grid: { initialSize: 6, initialPeekSlots: [4, 5] },
      powers: { peekManyCount: 3 },
      reactions: { ...DEFAULT_RULES.reactions, attemptsPerWindow: 2 },
    });
    for (let seed = 1; seed <= 30; seed++) {
      const { session } = simulate({ players: bots(2 + (seed % 5)), seed, rules });
      expect(session.phase).toBe('ended');
      expect(session.stats.botRejected).toBe(0);
    }
  }, 60_000);
});
