import { describe, expect, it } from 'vitest';
import { nextDeadline } from '../src/engine/index.js';
import { allCardsInState, c, facesIn, key, playing } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];
const G3 = ['2D', '3D', '4D', '5D'];

describe('draw', () => {
  it('only the current player can draw', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['AC'] });
    expect(game.fail('p2', { type: 'draw' })).toBe('NOT_YOUR_TURN');
    expect(game.fail('p3', { type: 'draw' })).toBe('NOT_YOUR_TURN');
    game.act('p1', { type: 'draw' });
    expect(game.state.turn).toMatchObject({ step: 'decide', drawnCard: c('AC') });
    expect(game.lastEvents).toEqual([{ type: 'cardDrawn', playerId: 'p1' }]);
  });

  it('shows the drawn card only to the player who drew it', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['QD'] });
    const pileBefore = game.state.drawPile.length;
    game.act('p1', { type: 'draw' });
    expect(game.state.drawPile).toHaveLength(pileBefore - 1);

    const mine = game.view('p1');
    expect(mine.turn).toMatchObject({ hasDrawnCard: true, drawnCard: c('QD') });
    for (const viewer of ['p2', 'p3', 'spectator']) {
      const view = game.view(viewer);
      expect(view.turn).toMatchObject({ hasDrawnCard: true, drawnCard: null });
      expect(facesIn(view)).not.toContain('Q:diamonds');
    }
    expect(facesIn(game.lastEvents)).toEqual([]);
  });

  it('cannot draw twice, nor decide before drawing', () => {
    const game = playing({ grids: [G1, G2] });
    expect(game.fail('p1', { type: 'discardDrawn' })).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'swapWithDrawn', slot: 0 })).toBe('INVALID_PHASE');
    game.act('p1', { type: 'draw' });
    expect(game.fail('p1', { type: 'draw' })).toBe('INVALID_PHASE');
  });

  it('other players cannot decide for the current player', () => {
    const game = playing({ grids: [G1, G2] }).act('p1', { type: 'draw' });
    expect(game.fail('p2', { type: 'discardDrawn' })).toBe('NOT_YOUR_TURN');
    expect(game.fail('p2', { type: 'swapWithDrawn', slot: 0 })).toBe('NOT_YOUR_TURN');
    expect(game.fail('p2', { type: 'skipPower' })).toBe('NOT_YOUR_TURN');
    expect(game.fail('p2', { type: 'callEnd' })).toBe('NOT_YOUR_TURN');
  });
});

describe('swap (trocar)', () => {
  it('puts the drawn card in the slot and the old one face up on the discard', () => {
    const game = playing({ grids: [G1, G2], draws: ['9C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 2 });
    expect(game.grid('p1')[2]).toEqual(c('9C'));
    expect(game.state.discardPile.at(-1)).toEqual(c('4S'));
    expect(game.state.turn).toMatchObject({ step: 'reaction', drawnCard: null, pendingPower: null });
    expect(game.lastEvents).toEqual([
      { type: 'drawnCardSwapped', playerId: 'p1', slot: 2, discarded: c('4S') },
      { type: 'reactionWindowOpened', card: c('4S'), openedBy: 'p1', deadline: game.now + 3000 },
    ]);
    const view = game.view('p2');
    expect(view.discardTop).toEqual(c('4S'));
    expect(view.players[0]?.slots[2]).toEqual({ state: 'hidden' });
    expect(facesIn(view)).toEqual(['4:spades', '4:spades']); // discard top + reaction window card
  });

  it('never activates a power, even when the drawn card has one', () => {
    const game = playing({ grids: [G1, G2], draws: ['7C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 0 }).closeWindow();
    expect(game.lastEvents.map((e) => e.type)).toEqual(['reactionWindowClosed', 'turnStarted']);
    expect(game.current).toBe('p2');
  });

  it('never activates the power of the card leaving the grid', () => {
    const game = playing({ grids: [['9S', '3S', '4S', '5S'], G2], draws: ['AC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 0 });
    expect(game.state.discardPile.at(-1)).toEqual(c('9S'));
    game.closeWindow();
    expect(game.current).toBe('p2');
  });

  it('validates the slot', () => {
    const game = playing({ grids: [G1, G2] }).act('p1', { type: 'draw' });
    expect(game.fail('p1', { type: 'swapWithDrawn', slot: 4 })).toBe('INVALID_SLOT');
    expect(game.fail('p1', { type: 'swapWithDrawn', slot: 99 })).toBe('INVALID_ACTION');
    const s = structuredClone(game.state);
    const removed = s.players[0]?.grid[1];
    if (!s.players[0] || !removed) throw new Error('setup');
    s.players[0].grid[1] = null;
    s.discardPile.push(removed);
    game.state = s;
    expect(game.fail('p1', { type: 'swapWithDrawn', slot: 1 })).toBe('EMPTY_SLOT');
  });
});

describe('discard (descartar)', () => {
  it('puts the drawn card on the discard and opens the reaction window', () => {
    const game = playing({ grids: [G1, G2], draws: ['6C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.state.discardPile.at(-1)).toEqual(c('6C'));
    expect(game.state.reaction).toMatchObject({ card: c('6C'), openedBy: 'p1', deadline: game.now + 3000 });
    expect(nextDeadline(game.state)).toBe(game.now + 3000);
    expect(game.lastEvents.map((e) => e.type)).toEqual(['drawnCardDiscarded', 'reactionWindowOpened']);
  });

  it('a card without power ends the turn when the window closes', () => {
    const game = playing({ grids: [G1, G2], draws: ['6C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.advance(2999);
    expect(game.current).toBe('p1');
    expect(game.state.turn?.step).toBe('reaction');
    game.advance(1);
    expect(game.current).toBe('p2');
    expect(game.state.turn).toMatchObject({ step: 'draw', number: 2 });
  });

  it('the current player waits for the window before anything else', () => {
    const game = playing({ grids: [G1, G2], draws: ['7C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.fail('p1', { type: 'usePower', power: 'peekOwn', slot: 0 })).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'skipPower' })).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'draw' })).toBe('INVALID_PHASE');
    expect(game.fail('p2', { type: 'draw' })).toBe('NOT_YOUR_TURN');
  });
});

describe('turn order', () => {
  it('goes around the table in seat order', () => {
    const game = playing({ grids: [G1, G2, G3], first: 'p2' });
    const order: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(game.current);
      game.drawAndDiscard(game.current as string);
    }
    expect(order).toEqual(['p2', 'p3', 'p1', 'p2', 'p3', 'p1']);
    expect(game.state.turnCount).toBe(7);
  });
});

describe('draw pile runs out', () => {
  it('reshuffles the discard pile except its top card into a new draw pile', () => {
    const game = playing({ grids: [G1, G2] });
    // Move the whole draw pile to the discard pile (top = last).
    const s = structuredClone(game.state);
    s.discardPile = [...s.drawPile];
    s.drawPile = [];
    game.state = s;
    const top = s.discardPile.at(-1);
    const total = s.discardPile.length;

    game.act('p1', { type: 'draw' });
    expect(game.lastEvents[0]).toEqual({ type: 'deckReshuffled', drawPileCount: total - 1 });
    expect(game.state.discardPile).toEqual([top]);
    expect(game.state.drawPile).toHaveLength(total - 2); // one card was just drawn
    const cards = allCardsInState(game.state);
    expect(cards).toHaveLength(54);
    expect(new Set(cards).size).toBe(54);
    expect(game.state.turn?.drawnCard && key(game.state.turn.drawnCard)).not.toBe(top && key(top));
  });

  it('reshuffles deterministically (same seed, same new pile)', () => {
    const run = () => {
      const game = playing({ grids: [G1, G2] });
      const s = structuredClone(game.state);
      s.discardPile = [...s.drawPile];
      s.drawPile = [];
      game.state = s;
      return game.act('p1', { type: 'draw' }).state.drawPile;
    };
    expect(run()).toEqual(run());
  });

  it('ends the game when there is no card left to draw anywhere', () => {
    const game = playing({ grids: [G1, G2] });
    const s = structuredClone(game.state);
    s.discardPile = [s.drawPile[0] as never];
    s.drawPile = [];
    game.state = s;
    game.act('p1', { type: 'draw' });
    expect(game.state.phase).toBe('ended');
    expect(game.state.result?.reason).toBe('deckExhausted');
  });
});
