import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, loadRules } from '../src/config/rules.js';
import { c, facesIn, playing, type TestGame } from './helpers.js';

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['6H', '7H', '8H', '9H'];
const G3 = ['AD', '6D', 'KH', 'JKR'];
const WINDOW = DEFAULT_RULES.timings.reactionWindowMs;
const CLAIM = DEFAULT_RULES.timings.reactionClaimMs;

function windowOpenWith(card = '6C', grids: string[][] = [G1, G2, G3]): TestGame {
  const game = playing({ grids, draws: [card] });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
  return game;
}

describe('claimReaction', () => {
  it('locks the window for the claimant and extends the deadline to now + reactionClaimMs', () => {
    const game = windowOpenWith();
    const opened = game.state.reaction?.deadline as number;
    expect(opened).toBe(game.now + WINDOW);
    game.advance(1000);
    game.act('p2', { type: 'claimReaction', kind: 'matchOpponent' });
    expect(game.lastEvents).toEqual([{ type: 'reactionClaimed', by: 'p2', kind: 'matchOpponent' }]);
    expect(game.state.reaction?.deadline).toBe(game.now + CLAIM);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      expect(game.view(viewer).reactionWindow).toMatchObject({
        claimedBy: 'p2',
        claimKind: 'matchOpponent',
        deadline: game.now + CLAIM,
      });
    }
  });

  it('an unclaimed window exposes claimedBy/claimKind as null', () => {
    const game = windowOpenWith();
    expect(game.view('p2').reactionWindow).toMatchObject({ claimedBy: null, claimKind: null });
  });

  it('a second claim is refused (REACTION_CLAIMED), and so is a repeated one by the claimant', () => {
    const game = windowOpenWith();
    game.act('p2', { type: 'claimReaction', kind: 'matchOpponent' });
    expect(game.fail('p3', { type: 'claimReaction', kind: 'matchOwn' })).toBe('REACTION_CLAIMED');
    expect(game.fail('p2', { type: 'claimReaction', kind: 'matchOpponent' })).toBe('REACTION_CLAIMED');
  });

  it('others cannot react while it is claimed; the claimant must use the claimed kind', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'claimReaction', kind: 'matchOpponent' });
    expect(game.fail('p3', { type: 'matchOwn', slot: 1 })).toBe('REACTION_CLAIMED');
    expect(game.fail('p1', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 })).toBe(
      'REACTION_CLAIMED',
    );
    expect(game.fail('p2', { type: 'matchOwn', slot: 0 })).toBe('INVALID_ACTION');
  });

  it('the claimant reacts after the normal window would have closed', () => {
    const game = windowOpenWith('6C');
    game.advance(WINDOW - 100);
    game.act('p3', { type: 'claimReaction', kind: 'matchOpponent' });
    game.advance(CLAIM - 1000); // well past the original deadline
    expect(game.state.reaction).not.toBeNull();
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 });
    expect(game.state.reaction).toBeNull();
    expect(game.lastEvents).toContainEqual({
      type: 'reactionResolved',
      by: 'p3',
      kind: 'matchOpponent',
      ok: true,
      slots: [
        { playerId: 'p2', slot: 0 },
        { playerId: 'p3', slot: 0 },
      ],
    });
  });

  it('claim expiring without action spends the attempt, reveals nothing and closes the window', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'claimReaction', kind: 'matchOwn' });
    game.advance(CLAIM - 1);
    expect(game.state.reaction).not.toBeNull();
    game.advance(1);
    expect(game.state.reaction).toBeNull();
    expect(game.lastEvents.map((e) => e.type)).toEqual([
      'reactionResolved',
      'reactionWindowClosed',
      'turnStarted',
    ]);
    expect(game.lastEvents[0]).toEqual({ type: 'reactionResolved', by: 'p2', kind: 'matchOwn', ok: false, slots: [] });
    expect(game.lastEvents[1]).toEqual({ type: 'reactionWindowClosed', reason: 'claimExpired' });
    expect(facesIn(game.lastEvents)).toEqual([]);
    expect(game.state.reveals).toEqual([]);
  });

  it('an expired claim is also applied when the next action arrives (no tick needed)', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'claimReaction', kind: 'matchOwn' });
    expect(game.fail('p3', { type: 'matchOwn', slot: 1 }, game.now + CLAIM)).toBe('REACTION_WINDOW_CLOSED');
  });

  it('a wrong reaction by the claimant follows the current rule (reveals their card), releases the lock', () => {
    const game = windowOpenWith('6C');
    game.act('p2', { type: 'claimReaction', kind: 'matchOwn' });
    game.advance(2000);
    game.act('p2', { type: 'matchOwn', slot: 1 }); // 7H is not a 6
    expect(game.lastEvents).toContainEqual(expect.objectContaining({ type: 'reactionFailed', revealed: c('7H') }));
    expect(game.view('p3').reactionWindow).toMatchObject({ claimedBy: null, claimKind: null });
    expect(game.state.reaction?.deadline).toBeGreaterThanOrEqual(game.now + WINDOW);
    // someone else can now claim and win
    game.act('p3', { type: 'claimReaction', kind: 'matchOwn' });
    game.act('p3', { type: 'matchOwn', slot: 1 });
    expect(game.state.reaction).toBeNull();
  });

  it('direct matchOwn / matchOpponent without a claim still work (bots, old clients)', () => {
    const a = windowOpenWith('6C');
    a.act('p2', { type: 'matchOwn', slot: 0 });
    expect(a.state.reaction).toBeNull();
    const b = windowOpenWith('6C');
    b.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 });
    expect(b.state.reaction).toBeNull();
  });

  it('refuses claims with no window, with attempts used up, with the kind switched off, or with a bad kind', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['6C'] });
    expect(game.fail('p2', { type: 'claimReaction', kind: 'matchOwn' })).toBe('REACTION_WINDOW_CLOSED');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.fail('p2', { type: 'claimReaction', kind: 'bogus' })).toBe('INVALID_ACTION');
    expect(game.fail('p2', { type: 'claimReaction' })).toBe('INVALID_ACTION');
    expect(game.fail('p2', { type: 'claimReaction', kind: 'matchOwn', extra: 1 })).toBe('INVALID_ACTION');
    expect(game.fail('stranger', { type: 'claimReaction', kind: 'matchOwn' })).toBe('UNKNOWN_PLAYER');
    game.act('p2', { type: 'matchOwn', slot: 1 }); // wrong
    game.act('p2', { type: 'matchOwn', slot: 2 }); // wrong: attempts used (2)
    expect(game.fail('p2', { type: 'claimReaction', kind: 'matchOwn' })).toBe('REACTION_ALREADY_ATTEMPTED');

    const rules = { ...DEFAULT_RULES, reactions: { ...DEFAULT_RULES.reactions, matchOpponent: false } };
    const off = playing({ grids: [G1, G2, G3], draws: ['6C'], rules });
    off.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(off.fail('p2', { type: 'claimReaction', kind: 'matchOpponent' })).toBe('REACTION_DISABLED');
  });
});

describe('the player whose turn it is can react to their own discard', () => {
  it('matchOwn by the discarder with a power pending; the power is still usable afterwards', () => {
    const game = playing({ grids: [['7S', '3S', '4S', '5S'], G2, G3], draws: ['7C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'reaction', pendingPower: 'peekOwn' });
    game.act('p1', { type: 'claimReaction', kind: 'matchOwn' });
    game.act('p1', { type: 'matchOwn', slot: 0 });
    expect(game.grid('p1')[0]).toBeNull();
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'power' });
    game.act('p1', { type: 'usePower', power: 'peekOwn', slot: 1 });
    expect(game.current).toBe('p2');
  });

  it('matchOpponent by the discarder with a power pending', () => {
    const game = playing({ grids: [G1, ['7D', '3H', '4H', '5H'], G3], draws: ['7C'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p1', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 });
    expect(game.grid('p2')[0]).toEqual(c('2S'));
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'power' });
  });

  it('the discarder can also claim; a claim by someone else locks the discarder out', () => {
    const game = windowOpenWith('6C');
    game.act('p3', { type: 'claimReaction', kind: 'matchOwn' });
    expect(game.fail('p1', { type: 'claimReaction', kind: 'matchOwn' })).toBe('REACTION_CLAIMED');
  });
});

describe('transparency events', () => {
  function powerGame(drawn: string, grids = [G1, G2, G3]): TestGame {
    const game = playing({ grids, draws: [drawn] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    return game;
  }

  it('peekOwn emits powerUsed + cardPeeked, without faces', () => {
    const game = powerGame('7C');
    game.act('p1', { type: 'usePower', power: 'peekOwn', slot: 2 });
    expect(game.lastEvents).toContainEqual({ type: 'cardPeeked', by: 'p1', target: { playerId: 'p1', slot: 2 } });
    expect(game.lastEvents).toContainEqual(expect.objectContaining({ type: 'powerUsed', by: 'p1', power: 'peekOwn' }));
    expect(facesIn(game.lastEvents)).toEqual([]);
  });

  it('peekOpponent emits cardPeeked for the target, without faces', () => {
    const game = powerGame('9C');
    game.act('p1', { type: 'usePower', power: 'peekOpponent', target: { playerId: 'p2', slot: 1 } });
    expect(game.lastEvents.filter((e) => e.type === 'cardPeeked')).toEqual([
      { type: 'cardPeeked', by: 'p1', target: { playerId: 'p2', slot: 1 } },
    ]);
    expect(facesIn(game.lastEvents)).toEqual([]);
  });

  it('K black: one cardPeeked per card seen; then cardsSwapped blind=false', () => {
    const game = powerGame('KS');
    game.act('p1', {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 0 },
        { playerId: 'p3', slot: 1 },
      ],
    });
    expect(game.lastEvents.filter((e) => e.type === 'cardPeeked')).toHaveLength(2);
    expect(facesIn(game.lastEvents)).toEqual([]);
    game.act('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p3', slot: 1 } });
    expect(game.lastEvents).toContainEqual({
      type: 'cardsSwapped',
      by: 'p1',
      a: { playerId: 'p1', slot: 0 },
      b: { playerId: 'p3', slot: 1 },
      blind: false,
    });
    expect(facesIn(game.lastEvents)).toEqual([]);
  });

  it('Q blind swap emits cardsSwapped blind=true', () => {
    const game = powerGame('QC');
    game.act('p1', { type: 'usePower', power: 'blindSwap', ownSlot: 1, target: { playerId: 'p2', slot: 2 } });
    expect(game.lastEvents).toContainEqual({
      type: 'cardsSwapped',
      by: 'p1',
      a: { playerId: 'p1', slot: 1 },
      b: { playerId: 'p2', slot: 2 },
      blind: true,
    });
    expect(facesIn(game.lastEvents)).toEqual([]);
  });

  it('skipping a power emits powerSkipped with "by"', () => {
    const game = powerGame('7C');
    game.act('p1', { type: 'skipPower' });
    expect(game.lastEvents).toContainEqual({ type: 'powerSkipped', by: 'p1', power: 'peekOwn', reason: 'player' });
  });

  it('reactionResolved on success names the positions but never the faces', () => {
    const game = windowOpenWith('6C');
    game.act('p3', { type: 'claimReaction', kind: 'matchOpponent' });
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 1 });
    const resolved = game.lastEvents.find((e) => e.type === 'reactionResolved');
    expect(resolved).toEqual({
      type: 'reactionResolved',
      by: 'p3',
      kind: 'matchOpponent',
      ok: true,
      slots: [
        { playerId: 'p2', slot: 0 },
        { playerId: 'p3', slot: 1 },
      ],
    });
    expect(facesIn(resolved)).toEqual([]);
  });
});

describe('MOISES_REACTION_CLAIM_MS', () => {
  it('defaults to 8000, accepts a valid override and rejects invalid ones', () => {
    expect(loadRules({}).timings.reactionClaimMs).toBe(8000);
    expect(loadRules({ MOISES_REACTION_CLAIM_MS: '5000' }).timings.reactionClaimMs).toBe(5000);
    expect(() => loadRules({ MOISES_REACTION_CLAIM_MS: 'abc' })).toThrow(/MOISES_REACTION_CLAIM_MS/);
    expect(() => loadRules({ MOISES_REACTION_CLAIM_MS: '10' })).toThrow(/MOISES_REACTION_CLAIM_MS/);
  });
});
