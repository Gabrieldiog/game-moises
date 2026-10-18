import { describe, expect, it } from 'vitest';
import { c, key, playing, type TestGame } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];
const G3 = ['2D', '3D', '4D', '5D'];

/** Records every turn start while playing `turns` draw+discard turns. */
function playTurns(game: TestGame, turns: number): string[] {
  const order: string[] = [];
  for (let i = 0; i < turns && game.state.phase === 'playing'; i++) {
    const player = game.current as string;
    order.push(player);
    game.drawAndDiscard(player);
  }
  return order;
}

describe('"Estou foda" (callEnd)', () => {
  it('can be called before drawing; the caller still plays the turn, then everyone else once', () => {
    const game = playing({ grids: [G1, G2, G3] });
    game.act('p1', { type: 'callEnd' });
    expect(game.lastEvents).toEqual([{ type: 'endCalled', playerId: 'p1', reason: 'called' }]);
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'draw' }); // the turn goes on
    expect(game.view('p2').endCall).toEqual({ callerId: 'p1', reason: 'called', pending: ['p2', 'p3'] });

    expect(playTurns(game, 10)).toEqual(['p1', 'p2', 'p3']);
    expect(game.state.phase).toBe('ended');
    expect(game.state.result?.reason).toBe('endCalled');
  });

  it.each([
    ['after drawing', (g: TestGame) => g.act('p1', { type: 'draw' })],
    ['during the reaction window', (g: TestGame) => g.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' })],
    ['during the power step', (g: TestGame) => g.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow()],
  ])('can be called %s', (_when, prepare) => {
    const game = playing({ grids: [G1, G2, G3], draws: ['JC'] });
    prepare(game);
    const step = game.state.turn?.step;
    game.act('p1', { type: 'callEnd' });
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step });
    expect(game.state.endCall?.pending).toEqual(['p2', 'p3']);
  });

  it('can be called after peeking with J, before deciding the swap', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['JC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    game.act('p1', { type: 'callEnd' });
    game.act('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } });
    expect(game.current).toBe('p2');
  });

  it('only the current player, and only once per game', () => {
    const game = playing({ grids: [G1, G2, G3] });
    expect(game.fail('p2', { type: 'callEnd' })).toBe('NOT_YOUR_TURN');
    game.act('p1', { type: 'callEnd' });
    expect(game.fail('p1', { type: 'callEnd' })).toBe('END_ALREADY_CALLED');
    game.drawAndDiscard('p1');
    expect(game.fail('p2', { type: 'callEnd' })).toBe('END_ALREADY_CALLED');
  });

  it('with two players: the caller plays, the other plays once, game over', () => {
    const game = playing({ grids: [G1, G2], first: 'p2' });
    game.act('p2', { type: 'callEnd' });
    expect(playTurns(game, 10)).toEqual(['p2', 'p1']);
    expect(game.state.phase).toBe('ended');
  });

  it('a caller in the middle of the table: the round wraps around', () => {
    const game = playing({ grids: [G1, G2, G3] });
    playTurns(game, 1); // p1
    game.act('p2', { type: 'callEnd' });
    expect(playTurns(game, 10)).toEqual(['p2', 'p3', 'p1']);
    expect(game.state.phase).toBe('ended');
  });

  it('the last discard still gets its reaction window before the end', () => {
    const game = playing({ grids: [G1, G2], draws: ['AC', '2C'] });
    game.act('p1', { type: 'callEnd' });
    playTurns(game, 1); // p1
    game.act('p2', { type: 'draw' }).act('p2', { type: 'discardDrawn' }); // 2C
    expect(game.state.phase).toBe('playing');
    game.act('p1', { type: 'matchOwn', slot: 0 }); // 2S
    expect(game.state.phase).toBe('ended');
    expect(game.state.players[0]?.grid[0]).toBeNull();
  });
});

describe('end of game', () => {
  function finished(grids: string[][]): TestGame {
    const game = playing({ grids });
    game.act('p1', { type: 'callEnd' });
    playTurns(game, 10);
    expect(game.state.phase).toBe('ended');
    return game;
  }

  it('reveals every card to everyone', () => {
    const game = finished([G1, G2, G3]);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      const view = game.view(viewer);
      expect(view.phase).toBe('ended');
      for (const player of view.players) {
        for (const slot of player.slots) expect(slot).toMatchObject({ state: 'visible', until: null });
      }
      expect(view.players[1]?.slots.map((slot) => slot.state === 'visible' && key(slot.card))).toEqual([
        '2:hearts',
        '3:hearts',
        '4:hearts',
        '5:hearts',
      ]);
    }
  });

  it('the lowest sum wins; red K = -1, joker = 0', () => {
    const game = finished([
      ['KH', 'KD', 'JKR', 'AS'], // -1 -1 + 0 + 1 = -1
      ['KS', 'QH', 'JS', '10C'], // 13 + 12 + 11 + 10 = 46
      ['2C', '3C', 'JKB', 'AC'], // 2 + 3 + 0 + 1 = 6
    ]);
    expect(game.state.result).toEqual({
      reason: 'endCalled',
      scores: [
        { playerId: 'p1', total: -1 },
        { playerId: 'p2', total: 46 },
        { playerId: 'p3', total: 6 },
      ],
      winners: ['p1'],
    });
    expect(game.lastEvents.at(-1)).toEqual({ type: 'gameEnded', result: game.state.result });
    expect(game.view('p2').result).toEqual(game.state.result);
  });

  it('a tie: everyone tied with the lowest sum wins', () => {
    const game = finished([
      ['AS', '2S', '3S', '4S'], // 10
      ['10H', 'KC', 'QC', 'JC'], // 46
      ['AH', '2H', '3H', '4H'], // 10
    ]);
    expect(game.state.result?.winners).toEqual(['p1', 'p3']);
  });

  it('refuses every action once the game is over', () => {
    const game = finished([G1, G2, G3]);
    for (const action of [
      { type: 'draw' },
      { type: 'callEnd' },
      { type: 'matchOwn', slot: 0 },
      { type: 'arrange', fromSlot: 0, toSlot: 1 },
    ]) {
      expect(game.fail('p1', action)).toBe('GAME_OVER');
      expect(game.fail('p2', action)).toBe('GAME_OVER');
    }
    expect(game.state.turn).toBeNull();
    expect(game.state.reaction).toBeNull();
  });
});

describe('running out of cards does not end the game by itself', () => {
  /** Leaves `playerId` with a single card (slot 0); the rest goes to the discard pile. */
  function keepOnlyFirstCard(game: TestGame, playerId: string): void {
    const s = structuredClone(game.state);
    const player = s.players.find((p) => p.id === playerId);
    if (!player) throw new Error('setup');
    s.discardPile.push(...(player.grid.slice(1).filter(Boolean) as never[]));
    player.grid = [player.grid[0] ?? null, null, null, null];
    game.state = s;
  }

  it('a player who sheds their last card keeps playing: no endCalled, no skipped turns', () => {
    const game = playing({ grids: [G1, ['6H', '3H', '4H', '5H'], G3], draws: ['6C'] });
    keepOnlyFirstCard(game, 'p2');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.lastEvents.map((e) => e.type)).toEqual(['reactionSucceeded', 'reactionResolved', 'reactionWindowClosed', 'turnStarted']);
    expect(game.state.endCall).toBeNull();
    expect(game.grid('p2').every((slot) => slot === null)).toBe(true);
    // p2 still gets its turns; the game goes on
    expect(playTurns(game, 6)).toEqual(['p2', 'p3', 'p1', 'p2', 'p3', 'p1']);
    expect(game.state.phase).toBe('playing');
  });

  it('the player with 0 cards can call "Estou foda" on their turn; everyone else plays one more turn', () => {
    const game = playing({ grids: [G1, ['6H', '3H', '4H', '5H'], G3], draws: ['6C'] });
    keepOnlyFirstCard(game, 'p2');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.current).toBe('p2');
    game.act('p2', { type: 'callEnd' });
    expect(game.state.endCall).toEqual({ callerId: 'p2', reason: 'called', pending: ['p3', 'p1'] });
    expect(playTurns(game, 10)).toEqual(['p2', 'p3', 'p1']);
    expect(game.state.phase).toBe('ended');
    expect(game.state.result?.reason).toBe('endCalled');
    expect(game.state.result?.scores.find((s) => s.playerId === 'p2')?.total).toBe(0);
    expect(game.state.result?.winners).toEqual(['p2']);
  });

  it('works when the current player empties their own grid: the game goes on', () => {
    const game = playing({ grids: [['6S', '3S', '4S', '5S'], G2, G3], draws: ['6C'] });
    keepOnlyFirstCard(game, 'p1');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p1', { type: 'matchOwn', slot: 0 });
    expect(game.state.endCall).toBeNull();
    expect(game.current).toBe('p2'); // 6S has no power; the turn moved on
    game.act('p2', { type: 'callEnd' });
    expect(game.state.endCall).toMatchObject({ callerId: 'p2', reason: 'called' });
  });

  it('by a matchOpponent: the reactor loses a card, the target keeps the count; nothing ends', () => {
    const game = playing({ grids: [G1, G2, ['AD', '3D', '4D', '5D']], draws: ['2C'] });
    keepOnlyFirstCard(game, 'p3');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 }); // 2H
    expect(game.grid('p2')[0]).toEqual(c('AD'));
    expect(game.state.endCall).toBeNull();
  });

  it('does nothing more once the end was already called', () => {
    const game = playing({ grids: [G1, ['6H', '3H', '4H', '5H'], G3], draws: ['6C'] });
    keepOnlyFirstCard(game, 'p2');
    game.act('p1', { type: 'callEnd' });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.lastEvents.some((e) => e.type === 'endCalled')).toBe(false);
    expect(game.state.endCall).toMatchObject({ callerId: 'p1', reason: 'called' });
  });
});
