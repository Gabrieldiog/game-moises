import { describe, expect, it } from 'vitest';
import { parseAction, type GameView, type PlayerView } from '@moises/shared';
import { buildScenario } from '../demo/fixtures';
import { clockOffset, secondsLeft, serverNow } from './clock';
import {
  NO_PICKS,
  arrangeAction,
  canPickOpponent,
  canPickOwn,
  pickPolicy,
  powerSwapAction,
  shoutAction,
  toggleOpponent,
  toggleOwn,
  usePowerAction,
} from './intent';
import {
  activeCountdown,
  canOfferCallEnd,
  effectiveSlot,
  opponentsInSeatOrder,
  seatAreas,
  uiContext,
} from './selectors';
import { endCallLines, statusLines } from './status';

const NOW = 1_000;
const scene = (id: Parameters<typeof buildScenario>[0], players = 4) => buildScenario(id, { players, now: NOW });

function seat(id: string, isYou = false): PlayerView {
  return { id, name: id, isYou, cardCount: 4, slots: [] };
}

describe('clock', () => {
  it('derives server time from the offset measured when the view arrived', () => {
    const offset = clockOffset(50_000, 10_000);
    expect(offset).toBe(40_000);
    expect(serverNow(offset, 10_500)).toBe(50_500);
  });

  it('rounds seconds up and never goes below zero', () => {
    expect(secondsLeft(5_000, 0)).toBe(5);
    expect(secondsLeft(5_000, 4_001)).toBe(1);
    expect(secondsLeft(5_000, 5_000)).toBe(0);
    expect(secondsLeft(5_000, 9_000)).toBe(0);
  });
});

describe('seats', () => {
  it('starts with the player right after you, wrapping around the table', () => {
    const view = { players: [seat('a'), seat('b'), seat('me', true), seat('c'), seat('d')] } as unknown as GameView;
    expect(opponentsInSeatOrder(view).map((p) => p.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('places up to 3 opponents across the top, then uses the sides', () => {
    expect(seatAreas(1)).toEqual(['top']);
    expect(seatAreas(3)).toEqual(['top', 'top', 'top']);
    expect(seatAreas(4)).toEqual(['left', 'top', 'top', 'right']);
    expect(seatAreas(5)).toEqual(['left', 'top', 'top', 'top', 'right']);
  });
});

describe('what the screen offers', () => {
  it('maps each fixture moment to its context', () => {
    expect(uiContext(scene('arrumacao'), NOW).kind).toBe('arrange');
    expect(uiContext(scene('espiada'), NOW).kind).toBe('initialPeek');
    expect(uiContext(scene('minha-vez'), NOW).kind).toBe('myDraw');
    expect(uiContext(scene('comprada'), NOW).kind).toBe('myDecide');
    expect(uiContext(scene('poder-j'), NOW)).toEqual({ kind: 'myPower', power: 'peekAndSwap', targetCount: 1 });
    expect(uiContext(scene('poder-k-troca'), NOW).kind).toBe('myPowerSwap');
    expect(uiContext(scene('reacao'), NOW)).toEqual({ kind: 'reaction', canReact: true });
    expect(uiContext(scene('reacao-gritei'), NOW)).toEqual({ kind: 'claim', reaction: 'matchOpponent' });
    expect(uiContext(scene('reacao-outro-gritou'), NOW)).toEqual({ kind: 'reaction', canReact: false });
    // A window open during your power keeps the power on screen (the shouts come next to it).
    expect(uiContext({ ...scene('poder-q'), reactionWindow: scene('reacao').reactionWindow }, NOW).kind).toBe('myPower');
    expect(uiContext(scene('vez-de-outro'), NOW)).toEqual({ kind: 'waiting', playerId: 's1' });
    expect(uiContext(scene('fim'), NOW).kind).toBe('ended');
    expect(uiContext({ ...scene('minha-vez'), you: null }, NOW).kind).toBe('spectator');
  });

  it('shows the countdown of the phase or of the reaction window, from the view', () => {
    const arrange = scene('arrumacao');
    expect(activeCountdown(arrange)).toEqual({ kind: 'arrange', deadline: arrange.phaseDeadline });
    const reaction = scene('reacao');
    expect(activeCountdown(reaction)).toEqual({ kind: 'reaction', deadline: reaction.reactionWindow!.deadline });
    expect(activeCountdown(scene('minha-vez'))).toBeNull();
    const mine = scene('reacao-gritei');
    expect(activeCountdown(mine)).toEqual({ kind: 'claim', deadline: mine.reactionWindow!.deadline });
    expect(activeCountdown(scene('reacao-outro-gritou'))?.kind).toBe('claimOther');
  });

  it('only offers "Estou foda" on your own turn while nobody called it', () => {
    expect(canOfferCallEnd(scene('minha-vez'))).toBe(true);
    expect(canOfferCallEnd(scene('vez-de-outro'))).toBe(false);
    expect(canOfferCallEnd(scene('estou-foda', 2))).toBe(false);
  });

  it('hides a timed card when its time is over', () => {
    const card = { kind: 'joker', color: 'red' } as const;
    expect(effectiveSlot({ state: 'visible', card, until: 10 }, 9).state).toBe('visible');
    expect(effectiveSlot({ state: 'visible', card, until: 10 }, 10).state).toBe('hidden');
    expect(effectiveSlot({ state: 'visible', card, until: null }, 99).state).toBe('visible');
  });

  it('writes the status lines and the end-call banner', () => {
    expect(statusLines(scene('minha-vez'), uiContext(scene('minha-vez'), NOW), NO_PICKS).title).toBe('Sua vez');
    expect(statusLines(scene('reacao'), uiContext(scene('reacao'), NOW), NO_PICKS).hint).toBe('Ana descartou 5♥. Grite, depois escolha.');
    expect(endCallLines(scene('estou-foda', 4))).toEqual({
      title: 'Ana falou “Estou foda”!',
      hint: 'Última vez de: Beto, Cida, Você.',
    });
    expect(endCallLines(scene('fim'))).toBeNull();
  });
});

describe('card selection', () => {
  it('arrange: two of your cards become an arrange action', () => {
    const policy = pickPolicy({ kind: 'arrange' });
    let picks = toggleOwn(NO_PICKS, 3, policy);
    expect(arrangeAction(picks)).toBeNull();
    picks = toggleOwn(picks, 0, policy);
    expect(arrangeAction(picks)).toEqual({ type: 'arrange', fromSlot: 3, toSlot: 0 });
  });

  it('tapping a chosen card again un-chooses it; single picks replace each other', () => {
    const policy = pickPolicy({ kind: 'myDecide' });
    const a = toggleOwn(NO_PICKS, 1, policy);
    expect(toggleOwn(a, 2, policy).own).toEqual([2]);
    expect(toggleOwn(a, 1, policy).own).toEqual([]);
  });

  it('empty positions and your own seat are never opponent targets', () => {
    const view = scene('estou-foda', 4);
    const policy = pickPolicy({ kind: 'myPower', power: 'peekOpponent', targetCount: 1 });
    const ana = view.players[1]!;
    expect(canPickOpponent(policy, ana, 0)).toBe(true);
    expect(canPickOpponent(policy, ana, 3)).toBe(false); // empty
    expect(canPickOpponent(policy, view.players[0]!, 0)).toBe(false); // you
    expect(canPickOwn(policy, view.players[0]!, 0)).toBe(false); // this power is about them
  });

  it('after a peek only the peeked cards can be swapped', () => {
    const view = scene('poder-k-troca', 4);
    const ctx = uiContext(view, NOW);
    if (ctx.kind !== 'myPowerSwap') throw new Error('unexpected context');
    // First which of the peeked cards, then yours.
    const policy = pickPolicy(ctx);
    const ana = view.players[1]!;
    expect(canPickOpponent(policy, ana, 0)).toBe(true);
    expect(canPickOpponent(policy, ana, 1)).toBe(false);
    expect(canPickOwn(policy, view.players[0]!, 2)).toBe(false);
    const target = toggleOpponent(NO_PICKS, { playerId: 's1', slot: 0 }, policy);
    const next = pickPolicy(ctx, target);
    expect(canPickOwn(next, view.players[0]!, 2)).toBe(true);
    expect(canPickOpponent(next, ana, 0)).toBe(false);
    const picks = toggleOwn(target, 2, next);
    expect(powerSwapAction(picks, ctx.peeked)).toEqual({
      type: 'powerSwap',
      ownSlot: 2,
      target: { playerId: 's1', slot: 0 },
    });
  });

  it('every action built from picks passes the shared schema', () => {
    const picks = { own: [1], opponents: [{ playerId: 's2', slot: 3 }] };
    const actions = [
      usePowerAction('peekOwn', picks),
      usePowerAction('peekOpponent', picks),
      usePowerAction('blindSwap', picks),
      usePowerAction('peekAndSwap', picks),
      usePowerAction('peekManyAndSwap', picks),
      shoutAction('matchOwn', picks),
      shoutAction('matchOpponent', picks),
    ];
    for (const action of actions) expect(parseAction(action).ok).toBe(true);
    expect(shoutAction('matchOpponent', { own: [], opponents: picks.opponents })).toBeNull();
  });
});
