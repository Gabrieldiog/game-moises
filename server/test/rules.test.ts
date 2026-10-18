import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  ENV_TIMING_LIMITS,
  RulesConfigSchema,
  TIMING_ENV_VARS,
  loadRules,
  parseRules,
  type RulesConfig,
} from '../src/config/rules.js';

function withRules(patch: (rules: RulesConfig) => void): unknown {
  const copy = structuredClone(DEFAULT_RULES) as RulesConfig;
  patch(copy);
  return copy;
}

describe('DEFAULT_RULES', () => {
  it('passes its own schema', () => {
    expect(RulesConfigSchema.safeParse(DEFAULT_RULES).success).toBe(true);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RULES.cards.values)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RULES.grid.initialPeekSlots)).toBe(true);
  });

  it('matches docs/REGRAS.md', () => {
    expect(DEFAULT_RULES.players).toEqual({ min: 2, max: 6 });
    expect(DEFAULT_RULES.grid).toEqual({ initialSize: 4, initialPeekSlots: [2, 3] });
    expect(DEFAULT_RULES.timings).toEqual({
      arrangeMs: 5000,
      initialPeekMs: 5000,
      reactionWindowMs: 3000,
      revealMs: 3000,
      turnMs: 15000,
    });
    expect(DEFAULT_RULES.cards.redOverrides.K).toEqual({ value: -1, power: null });
    expect(DEFAULT_RULES.cards.joker).toEqual({ value: 0, power: null });
    expect(DEFAULT_RULES.powers.peekManyCount).toBe(2);
    expect(DEFAULT_RULES.reactions).toMatchObject({ attemptsPerWindow: 2, matchOwn: true, matchOpponent: true });
  });
});

describe('loadRules', () => {
  it('returns the defaults when no variable is set', () => {
    expect(loadRules({})).toEqual(DEFAULT_RULES);
  });

  it('ignores empty variables', () => {
    expect(loadRules({ MOISES_REACTION_WINDOW_MS: '  ' })).toEqual(DEFAULT_RULES);
  });

  it('overrides every timing from its variable', () => {
    const rules = loadRules({
      MOISES_ARRANGE_MS: '7000',
      MOISES_INITIAL_PEEK_MS: '4000',
      MOISES_REACTION_WINDOW_MS: '2500',
      MOISES_REVEAL_MS: ' 1500 ',
      MOISES_TURN_MS: '20000',
    });
    expect(rules.timings).toEqual({
      arrangeMs: 7000,
      initialPeekMs: 4000,
      reactionWindowMs: 2500,
      revealMs: 1500,
      turnMs: 20000,
    });
    expect(rules.cards).toEqual(DEFAULT_RULES.cards);
    expect(Object.isFrozen(rules.timings)).toBe(true);
  });

  it('only exposes timing variables', () => {
    expect(Object.keys(TIMING_ENV_VARS).sort()).toEqual(Object.keys(DEFAULT_RULES.timings).sort());
  });

  it.each([
    'abc',
    '1.5',
    '-100',
    '1e4',
    '0x10',
    String(ENV_TIMING_LIMITS.minMs - 1),
    String(ENV_TIMING_LIMITS.maxMs + 1),
  ])('rejects %j and names the variable', (raw) => {
    expect(() => loadRules({ MOISES_REVEAL_MS: raw })).toThrow(/MOISES_REVEAL_MS/);
  });

  it('accepts the limits themselves', () => {
    expect(loadRules({ MOISES_ARRANGE_MS: String(ENV_TIMING_LIMITS.minMs) }).timings.arrangeMs).toBe(ENV_TIMING_LIMITS.minMs);
    expect(loadRules({ MOISES_ARRANGE_MS: String(ENV_TIMING_LIMITS.maxMs) }).timings.arrangeMs).toBe(ENV_TIMING_LIMITS.maxMs);
  });
});

describe('parseRules', () => {
  it.each([
    ['min players below 2', (r: RulesConfig) => void (r.players.min = 1)],
    ['max below min', (r: RulesConfig) => void (r.players.max = 1)],
    ['too many players for the deck', (r: RulesConfig) => void (r.players.max = 14)],
    ['peek slot outside the grid', (r: RulesConfig) => void (r.grid.initialPeekSlots = [2, 4])],
    ['repeated peek slot', (r: RulesConfig) => void (r.grid.initialPeekSlots = [3, 3])],
    ['non-integer card value', (r: RulesConfig) => void (r.cards.values.A = 1.5)],
    ['zero reaction window', (r: RulesConfig) => void (r.timings.reactionWindowMs = 0)],
    ['repeated joker color', (r: RulesConfig) => void (r.deck.jokerColors = ['red', 'red'])],
    ['unknown key', (r: RulesConfig) => void ((r as unknown as Record<string, unknown>)['cheat'] = true)],
    ['unknown power', (r: RulesConfig) => void ((r.cards.powers as Record<string, unknown>)['A'] = 'seeAll')],
  ])('rejects %s', (_name, patch) => {
    expect(() => parseRules(withRules(patch))).toThrow(/Invalid rules config/);
  });

  it('rejects a missing rank value', () => {
    const rules = withRules((r) => {
      delete (r.cards.values as Partial<Record<string, number>>)['Q'];
    });
    expect(() => parseRules(rules)).toThrow();
  });
});
