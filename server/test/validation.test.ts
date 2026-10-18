import { describe, expect, it } from 'vitest';
import { applyAction, tick, viewFor, type GameState } from '../src/engine/index.js';
import { playing } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];

describe('applyAction trusts nothing from the caller', () => {
  it.each([
    null,
    undefined,
    42,
    'draw',
    [],
    {},
    { type: 'draw', card: { kind: 'standard', rank: 'K', suit: 'hearts' } },
    { type: 'swapWithDrawn' },
    { type: 'swapWithDrawn', slot: '0' },
    { type: 'swapWithDrawn', slot: 0.5 },
    { type: 'swapWithDrawn', slot: 1e9 },
    { type: 'usePower', power: 'peekOwn' },
    { type: 'usePower', power: 'peekOwn', slot: 0, value: 13 },
    { type: 'matchOpponent', target: { playerId: 'p2' }, giveSlot: 0 },
    { type: 'matchOpponent', target: { playerId: 'x'.repeat(65), slot: 0 }, giveSlot: 0 },
    { type: 'scoreSet', score: -100 },
    JSON.parse('{"type":"draw","__proto__":{"isAdmin":true}}'),
  ])('rejects malformed action %j with INVALID_ACTION', (action) => {
    const game = playing({ grids: [G1, G2] });
    expect(game.fail('p1', action)).toBe('INVALID_ACTION');
  });

  it.each([undefined, null, 42, {}, 'P1', 'p9', ''])('rejects player id %j with UNKNOWN_PLAYER', (playerId) => {
    const game = playing({ grids: [G1, G2] });
    expect(game.fail(playerId, { type: 'draw' })).toBe('UNKNOWN_PLAYER');
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY, '1000', null, undefined])('rejects now = %j with INVALID_TIME', (now) => {
    const game = playing({ grids: [G1, G2] });
    const result = applyAction(game.state, 'p1', { type: 'draw' }, now);
    expect(result.ok ? 'OK' : result.error.code).toBe('INVALID_TIME');
  });

  it('refuses something that is not a game state', () => {
    expect(() => applyAction({} as GameState, 'p1', { type: 'draw' }, 0)).toThrow(TypeError);
    expect(() => applyAction(null as unknown as GameState, 'p1', { type: 'draw' }, 0)).toThrow(TypeError);
  });

  it('tick and viewFor refuse an invalid clock', () => {
    const game = playing({ grids: [G1, G2] });
    expect(() => tick(game.state, Number.NaN)).toThrow(RangeError);
    expect(() => viewFor(game.state, 'p1', -5)).toThrow(RangeError);
  });

  it('error results carry a code and a message, never a state', () => {
    const game = playing({ grids: [G1, G2] });
    const result = applyAction(game.state, 'p2', { type: 'draw' }, game.now);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_YOUR_TURN', message: expect.any(String) } });
  });
});
