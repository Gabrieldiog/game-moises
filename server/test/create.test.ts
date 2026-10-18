import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type RulesConfig } from '../src/config/rules.js';
import { buildDeck, createGame, type CreateGameOptions } from '../src/engine/index.js';
import { SEED, T0, allCardsInState, c, key, stackDeck } from './helpers.js';

function players(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
}

function create(overrides: Partial<CreateGameOptions> = {}) {
  return createGame({ players: players(3), seed: SEED, now: T0, ...overrides });
}

function errorCode(result: ReturnType<typeof createGame>) {
  return result.ok ? 'OK' : result.error.code;
}

describe('createGame', () => {
  it.each([2, 3, 4, 5, 6])('deals 4 face-down cards to each of %i players', (n) => {
    const result = create({ players: players(n) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { state } = result;
    expect(state.players).toHaveLength(n);
    for (const player of state.players) {
      expect(player.grid).toHaveLength(4);
      expect(player.grid.every((slot) => slot !== null)).toBe(true);
    }
    expect(state.drawPile).toHaveLength(54 - 4 * n);
    expect(state.discardPile).toEqual([]);
    const cards = allCardsInState(state);
    expect(cards).toHaveLength(54);
    expect(new Set(cards).size).toBe(54);
  });

  it('starts the arrangement phase with a 5 s deadline', () => {
    const result = create();
    if (!result.ok) throw new Error('create failed');
    expect(result.state.phase).toBe('arrange');
    expect(result.state.phaseDeadline).toBe(T0 + 5000);
    expect(result.state.turn).toBeNull();
    expect(result.events).toEqual([{ type: 'phaseChanged', phase: 'arrange', deadline: T0 + 5000 }]);
  });

  it.each([1, 7])('rejects %i players', (n) => {
    expect(errorCode(create({ players: players(n) }))).toBe('INVALID_PLAYERS');
  });

  it.each([
    ['duplicate ids', [{ id: 'p1', name: 'A' }, { id: 'p1', name: 'B' }]],
    ['bad id characters', [{ id: 'p 1', name: 'A' }, { id: 'p2', name: 'B' }]],
    ['empty name', [{ id: 'p1', name: '   ' }, { id: 'p2', name: 'B' }]],
    ['long name', [{ id: 'p1', name: 'x'.repeat(33) }, { id: 'p2', name: 'B' }]],
    ['extra fields', [{ id: 'p1', name: 'A', admin: true }, { id: 'p2', name: 'B' }]],
  ])('rejects %s', (_name, list) => {
    expect(errorCode(create({ players: list as CreateGameOptions['players'] }))).toBe('INVALID_PLAYERS');
  });

  it.each(['', 'short', 'x'.repeat(513)])('rejects seed %j', (seed) => {
    expect(errorCode(create({ seed }))).toBe('INVALID_SEED');
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('rejects now = %s', (now) => {
    expect(errorCode(create({ now }))).toBe('INVALID_TIME');
  });

  it('rejects invalid rules', () => {
    const rules = structuredClone(DEFAULT_RULES) as RulesConfig;
    rules.players.min = 1;
    expect(errorCode(create({ rules }))).toBe('INVALID_RULES');
  });

  it('respects the player limits from the config', () => {
    const rules = structuredClone(DEFAULT_RULES) as RulesConfig;
    rules.players.max = 3;
    expect(errorCode(create({ rules, players: players(4) }))).toBe('INVALID_PLAYERS');
  });

  it('is deterministic for the same seed', () => {
    const a = create();
    const b = create();
    expect(a).toEqual(b);
  });

  it('shuffles differently with another seed', () => {
    const a = create();
    const b = create({ seed: 'another-seed-9876543210' });
    if (!a.ok || !b.ok) throw new Error('create failed');
    expect(a.state.drawPile).not.toEqual(b.state.drawPile);
  });

  it('draws the first player from the seed, unless given', () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const result = create({ seed: `first-player-seed-${i}` });
      if (result.ok) firsts.add(result.state.firstPlayerId);
    }
    expect([...firsts].sort()).toEqual(['p1', 'p2', 'p3']);

    const fixed = create({ firstPlayerId: 'p2' });
    expect(fixed.ok && fixed.state.firstPlayerId).toBe('p2');
    expect(errorCode(create({ firstPlayerId: 'nobody' }))).toBe('INVALID_PLAYERS');
  });

  it('deals round-robin from a fixed deck', () => {
    const grids = [
      ['AS', '2S', '3S', '4S'],
      ['AH', '2H', '3H', '4H'],
    ].map((grid) => grid.map(c));
    const result = create({ players: players(2), deck: stackDeck(grids, [c('KD')]) });
    if (!result.ok) throw new Error('create failed');
    expect(result.state.players[0]?.grid.map((card) => card && key(card))).toEqual(['A:spades', '2:spades', '3:spades', '4:spades']);
    expect(result.state.players[1]?.grid.map((card) => card && key(card))).toEqual(['A:hearts', '2:hearts', '3:hearts', '4:hearts']);
    expect(result.state.drawPile[0]).toEqual(c('KD'));
  });

  it.each([
    ['too short', () => buildDeck(DEFAULT_RULES).slice(1)],
    ['repeated card', () => [c('AS'), ...buildDeck(DEFAULT_RULES).slice(1)].map((card, i) => (i === 1 ? c('AS') : card))],
    ['card with extra data', () => buildDeck(DEFAULT_RULES).map((card, i) => (i === 0 ? { ...card, value: 99 } : card))],
    ['not a card', () => buildDeck(DEFAULT_RULES).map((card, i) => (i === 0 ? ({ kind: 'standard', rank: '1', suit: 'spades' } as unknown as typeof card) : card))],
  ])('rejects a fixed deck: %s', (_name, makeDeck) => {
    expect(errorCode(create({ deck: makeDeck() }))).toBe('INVALID_DECK');
  });

  it('produces plain JSON data (serializable game state)', () => {
    const result = create();
    if (!result.ok) throw new Error('create failed');
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
  });
});
