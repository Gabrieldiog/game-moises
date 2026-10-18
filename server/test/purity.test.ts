import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@moises/shared';
import { applyAction, createGame, tick, viewFor, type GameState } from '../src/engine/index.js';
import { SEED, T0, deepFreeze, playing } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];

describe('engine purity', () => {
  it('never mutates the state it receives (frozen input)', () => {
    const game = playing({ grids: [G1, G2], draws: ['7C'] });
    const frozen = deepFreeze(structuredClone(game.state));
    const snapshot = structuredClone(frozen);

    const drew = applyAction(frozen, 'p1', { type: 'draw' }, game.now);
    expect(drew.ok).toBe(true);
    expect(applyAction(frozen, 'p2', { type: 'draw' }, game.now).ok).toBe(false);
    expect(() => tick(frozen, game.now + 60_000)).not.toThrow();
    expect(() => viewFor(frozen, 'p1', game.now)).not.toThrow();
    expect(frozen).toEqual(snapshot);

    if (!drew.ok) return;
    const discarded = applyAction(deepFreeze(drew.state), 'p1', { type: 'discardDrawn' }, game.now);
    expect(discarded.ok).toBe(true);
  });

  it('returns a new state that shares nothing with the input', () => {
    const game = playing({ grids: [G1, G2] });
    const input = game.state;
    const result = applyAction(input, 'p1', { type: 'draw' }, game.now);
    if (!result.ok) throw new Error('draw failed');
    expect(result.state).not.toBe(input);
    result.state.players[0]?.grid.fill(null);
    result.state.drawPile.length = 0;
    expect(input.players[0]?.grid.every(Boolean)).toBe(true);
    expect(input.drawPile.length).toBeGreaterThan(0);
  });

  it('is deterministic: same seed, same actions, same times -> same states and events', () => {
    const replay = () => {
      const created = createGame({
        players: [
          { id: 'p1', name: 'A' },
          { id: 'p2', name: 'B' },
          { id: 'p3', name: 'C' },
        ],
        seed: SEED,
        now: T0,
      });
      if (!created.ok) throw new Error('create failed');
      let state: GameState = created.state;
      const events: GameEvent[] = [...created.events];
      let now = T0;
      const step = (playerId: string, action: unknown) => {
        const result = applyAction(state, playerId, action, now);
        if (result.ok) {
          state = result.state;
          events.push(...result.events);
        }
      };
      step('p2', { type: 'arrange', fromSlot: 0, toSlot: 3 });
      now += 10_000;
      ({ state } = tick(state, now)); // -> initialPeek (full 5 s from now)
      now = state.phaseDeadline as number;
      ({ state } = tick(state, now)); // -> playing
      expect(state.phase).toBe('playing');
      for (let turn = 0; turn < 12 && state.phase === 'playing'; turn++) {
        const current = state.turn?.playerId as string;
        step(current, { type: 'draw' });
        step(current, turn % 2 ? { type: 'discardDrawn' } : { type: 'swapWithDrawn', slot: turn % 4 });
        now = (state.reaction?.deadline ?? now) + 1;
        const ticked = tick(state, now);
        state = ticked.state;
        events.push(...ticked.events);
        if (state.turn?.step === 'power') step(current, { type: 'skipPower' });
      }
      return { state, events };
    };
    const a = replay();
    const b = replay();
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
    expect(a.events.length).toBeGreaterThan(20);
  });
});
