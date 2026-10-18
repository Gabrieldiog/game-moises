import { describe, expect, it } from 'vitest';
import type { Action, GameEvent, GameView, PlayerId } from '@moises/shared';
import { DEFAULT_RULES } from '../src/config/rules.js';
import { applyAction, createGame, tick, viewFor, type GameState } from '../src/engine/index.js';
import { SEED, T0, allCardsInState, facesIn, key, playing } from './helpers.js';

const VIEW_KEYS = [
  'discardCount',
  'discardTop',
  'drawPileCount',
  'endCall',
  'now',
  'phase',
  'phaseDeadline',
  'players',
  'reactionWindow',
  'result',
  'turn',
  'you',
].sort();

const FORBIDDEN_IN_JSON = ['drawPile"', '"rng"', '"seed"', '"counter"', '"reveals"', '"rules"', '"attempts"'];

/**
 * Independent statement of what a viewer may see (REGRAS.md), used as an oracle.
 * `s` must already be ticked to `now`.
 */
function allowedFaces(s: GameState, viewer: PlayerId | null, now: number): Set<string> {
  const allowed = new Set<string>();
  const top = s.discardPile.at(-1);
  if (top) allowed.add(key(top));
  if (s.reaction) allowed.add(key(s.reaction.card));
  if (s.turn?.drawnCard && viewer !== null && s.turn.playerId === viewer) allowed.add(key(s.turn.drawnCard));
  const me = s.players.find((p) => p.id === viewer);
  if (s.phase === 'initialPeek' && me) {
    for (const slot of [2, 3]) {
      const card = me.grid[slot];
      if (card) allowed.add(key(card));
    }
  }
  if (s.phase === 'ended') {
    for (const player of s.players) for (const card of player.grid) if (card) allowed.add(key(card));
  }
  for (const reveal of s.reveals) {
    if (reveal.expiresAt <= now) continue;
    if (reveal.viewers === 'all' || (viewer !== null && reveal.viewers.includes(viewer))) allowed.add(key(reveal.card));
  }
  return allowed;
}

/** Faces that are public right after an action/tick (what events may carry). */
function publicFaces(s: GameState, now: number): Set<string> {
  const allowed = new Set(s.discardPile.map(key));
  if (s.reaction) allowed.add(key(s.reaction.card));
  for (const reveal of s.reveals) if (reveal.viewers === 'all' && reveal.expiresAt > now) allowed.add(key(reveal.card));
  if (s.phase === 'ended') for (const player of s.players) for (const card of player.grid) if (card) allowed.add(key(card));
  return allowed;
}

function checkView(state: GameState, viewer: PlayerId, now: number): GameView {
  const view = viewFor(state, viewer, now);
  const s = tick(state, now).state;
  const json = JSON.stringify(view);

  expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
  for (const needle of FORBIDDEN_IN_JSON) expect(json).not.toContain(needle);
  expect(json).not.toContain(SEED);

  const allowed = allowedFaces(s, view.you, now);
  for (const face of facesIn(view)) {
    expect(allowed.has(face), `viewer ${viewer} must not see ${face} (phase ${s.phase})`).toBe(true);
  }
  // Cards in the draw pile are never visible to anybody.
  const drawPile = new Set(s.drawPile.map(key));
  for (const face of facesIn(view)) expect(drawPile.has(face)).toBe(false);

  // Each visible slot shows exactly the card that is there; hidden slots carry nothing else.
  view.players.forEach((player, p) => {
    player.slots.forEach((slot, i) => {
      const actual = s.players[p]?.grid[i] ?? null;
      if (slot.state === 'empty') expect(actual).toBeNull();
      if (slot.state === 'hidden') expect(slot).toEqual({ state: 'hidden' });
      if (slot.state === 'visible') expect(actual && key(actual)).toBe(key(slot.card));
    });
  });
  return view;
}

describe('viewFor never leaks hidden cards', () => {
  it('a fresh game shows no card face to anybody', () => {
    const created = createGame({
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
      seed: SEED,
      now: T0,
    });
    if (!created.ok) throw new Error('create failed');
    for (const viewer of ['p1', 'p2', 'nobody']) {
      const view = checkView(created.state, viewer, T0);
      expect(facesIn(view)).toEqual([]);
      expect(view.drawPileCount).toBe(46);
    }
  });

  it('hidden and empty slots are bare markers', () => {
    const game = playing({ grids: [['2S', '3S', '4S', '5S'], ['2H', '3H', '4H', '5H']] });
    const view = game.view('p1');
    expect(view.players[1]?.slots).toEqual([{ state: 'hidden' }, { state: 'hidden' }, { state: 'hidden' }, { state: 'hidden' }]);
    expect(JSON.stringify(view.players)).not.toMatch(/spades|hearts/);
  });

  it('an unknown viewer gets a spectator view', () => {
    const game = playing({ grids: [['2S', '3S', '4S', '5S'], ['2H', '3H', '4H', '5H']], draws: ['9C'] });
    game.act('p1', { type: 'draw' });
    const view = game.view('intruder');
    expect(view.you).toBeNull();
    expect(view.players.every((p) => !p.isYou)).toBe(true);
    expect(view.turn?.drawnCard).toBeNull();
    expect(facesIn(view)).toEqual([]);
  });

  it('mutating a view does not touch the game state', () => {
    const game = playing({ grids: [['2S', '3S', '4S', '5S'], ['2H', '3H', '4H', '5H']], draws: ['9C'] });
    game.act('p1', { type: 'draw' });
    const before = structuredClone(game.state);
    const view = game.view('p1') as unknown as { turn: { drawnCard: { rank: string } } };
    view.turn.drawnCard.rank = 'A';
    expect(game.state).toEqual(before);
  });
});

// --- property test: random complete games --------------------------------------------

function botRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Move {
  playerId: PlayerId;
  action: unknown;
}

function chooseMove(s: GameState, rand: () => number, callEndAfterTurn: number): Move | 'wait' {
  const ids = s.players.map((p) => p.id);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const slot = () => Math.floor(rand() * 5); // sometimes out of range on purpose
  const someone = () => pick(ids);
  const target = (not?: PlayerId) => ({ playerId: pick(ids.filter((id) => id !== not)), slot: slot() });

  if (rand() < 0.1) {
    // Garbage or out-of-place actions from anybody: must be refused without side effects, or be legal.
    const garbage: unknown[] = [
      { type: 'draw' },
      { type: 'discardDrawn' },
      { type: 'swapWithDrawn', slot: slot() },
      { type: 'matchOwn', slot: slot() },
      { type: 'matchOpponent', target: target(), giveSlot: slot() },
      { type: 'usePower', power: 'peekOwn', slot: slot() },
      { type: 'usePower', power: 'peekOpponent', target: target() },
      { type: 'powerSwap', ownSlot: slot(), target: target() },
      { type: 'skipPower' },
      { type: 'callEnd' },
      { type: 'arrange', fromSlot: slot(), toSlot: slot() },
      { type: 'draw', card: { kind: 'standard', rank: 'K', suit: 'hearts' } },
      { nonsense: true },
    ];
    return { playerId: rand() < 0.1 ? 'stranger' : someone(), action: pick(garbage) };
  }

  if (s.phase === 'arrange') {
    return rand() < 0.5 ? { playerId: someone(), action: { type: 'arrange', fromSlot: slot() % 4, toSlot: slot() % 4 } } : 'wait';
  }
  if (s.phase !== 'playing' || !s.turn) return 'wait';
  const me = s.turn.playerId;

  if (s.reaction) {
    if (rand() < 0.35) {
      const reactor = someone();
      return rand() < 0.5
        ? { playerId: reactor, action: { type: 'matchOwn', slot: slot() % 4 } }
        : { playerId: reactor, action: { type: 'matchOpponent', target: target(reactor), giveSlot: slot() % 4 } };
    }
    if (rand() < 0.1 && !s.endCall) return { playerId: me, action: { type: 'callEnd' } };
    return 'wait';
  }

  switch (s.turn.step) {
    case 'draw':
      if (!s.endCall && s.turnCount > callEndAfterTurn && rand() < 0.3) return { playerId: me, action: { type: 'callEnd' } };
      return { playerId: me, action: { type: 'draw' } };
    case 'decide':
      return rand() < 0.5
        ? { playerId: me, action: { type: 'swapWithDrawn', slot: slot() % 4 } }
        : { playerId: me, action: { type: 'discardDrawn' } };
    case 'power': {
      if (rand() < 0.25) return { playerId: me, action: { type: 'skipPower' } };
      const power = s.turn.pendingPower;
      const actions: Record<string, Action> = {
        peekOwn: { type: 'usePower', power: 'peekOwn', slot: slot() % 4 },
        peekOpponent: { type: 'usePower', power: 'peekOpponent', target: target(me) },
        blindSwap: { type: 'usePower', power: 'blindSwap', ownSlot: slot() % 4, target: target(me) },
        peekAndSwap: { type: 'usePower', power: 'peekAndSwap', target: target(me) },
        peekManyAndSwap: { type: 'usePower', power: 'peekManyAndSwap', targets: [target(me), target(me)] },
      };
      return { playerId: me, action: actions[power as string] };
    }
    case 'powerSwap':
      if (rand() < 0.4) return { playerId: me, action: { type: 'skipPower' } };
      return { playerId: me, action: { type: 'powerSwap', ownSlot: slot() % 4, target: pick(s.turn.peeked) } };
    case 'reaction':
      return 'wait';
  }
}

function nextTime(s: GameState, now: number, rand: () => number): number {
  const deadlines = [s.phaseDeadline, s.reaction?.deadline, ...s.reveals.map((r) => r.expiresAt)].filter(
    (t): t is number => typeof t === 'number' && t > now,
  );
  if (deadlines.length > 0 && rand() < 0.7) return Math.min(...deadlines);
  return now + Math.floor(rand() * 1500);
}

function checkInvariants(s: GameState): void {
  const cards = allCardsInState(s);
  expect(cards).toHaveLength(54);
  expect(new Set(cards).size).toBe(54);
  for (const player of s.players) expect(player.grid).toHaveLength(DEFAULT_RULES.grid.initialSize);
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
}

function checkEvents(events: GameEvent[], s: GameState, now: number): void {
  const allowed = publicFaces(s, now);
  for (const face of facesIn(events)) expect(allowed.has(face), `event leaked ${face}`).toBe(true);
  expect(JSON.stringify(events)).not.toContain(SEED);
}

describe('property: random full games never leak and keep invariants', () => {
  const GAMES = 24;
  const seen = new Map<string, number>();
  const record = (events: GameEvent[]) => {
    for (const event of events) {
      const name =
        event.type === 'powerUsed'
          ? `powerUsed:${event.power}`
          : event.type === 'reactionSucceeded' || event.type === 'reactionFailed'
            ? `${event.type}:${event.reaction}`
            : event.type === 'endCalled'
              ? `endCalled:${event.reason}`
              : event.type === 'gameEnded'
                ? `gameEnded:${event.result.reason}`
                : event.type;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
  };

  it.each(Array.from({ length: GAMES }, (_, i) => i))('game #%i', (index) => {
    const rand = botRandom(1000 + index);
    const playerCount = 2 + (index % 5); // 2..6 players
    const created = createGame({
      players: Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
      seed: `${SEED}-${index}`,
      now: T0,
    });
    if (!created.ok) throw new Error('create failed');
    let state = created.state;
    let now = T0;
    const viewers = [...state.players.map((p) => p.id), 'spectator'];
    let steps = 0;
    const callEndAfterTurn = 15 + (index % 3) * 35; // some short games, some long ones (reshuffles)

    while (state.phase !== 'ended' && steps < 4000) {
      steps++;
      const move = chooseMove(state, rand, callEndAfterTurn);
      if (move === 'wait') {
        now = nextTime(state, now, rand);
        const ticked = tick(state, now);
        checkEvents(ticked.events, ticked.state, now);
        record(ticked.events);
        state = ticked.state;
      } else {
        const before = structuredClone(state);
        const result = applyAction(state, move.playerId, move.action, now);
        if (result.ok) {
          checkEvents(result.events, result.state, now);
          record(result.events);
          state = result.state;
        } else {
          expect(state).toEqual(before); // a refused action changes nothing
        }
      }
      checkInvariants(state);
      for (const viewer of viewers) checkView(state, viewer, now);
    }

    expect(state.phase).toBe('ended');
    const winners = state.result?.winners ?? [];
    const scores = state.result?.scores ?? [];
    const best = Math.min(...scores.map((score) => score.total));
    expect(winners).toEqual(scores.filter((score) => score.total === best).map((score) => score.playerId));
    for (const viewer of viewers) {
      const view = checkView(state, viewer, now);
      expect(view.players.flatMap((p) => p.slots).every((slot) => slot.state !== 'hidden')).toBe(true);
    }
  });

  it('the random games exercised every rule', () => {
    for (const name of [
      'cardsArranged',
      'drawnCardSwapped',
      'drawnCardDiscarded',
      'deckReshuffled',
      'powerUsed:peekOwn',
      'powerUsed:peekOpponent',
      'powerUsed:blindSwap',
      'powerUsed:peekAndSwap',
      'powerUsed:peekManyAndSwap',
      'powerSwapped',
      'powerSkipped',
      'reactionSucceeded:matchOwn',
      'reactionSucceeded:matchOpponent',
      'reactionFailed:matchOwn',
      'reactionFailed:matchOpponent',
      'endCalled:called',
      'gameEnded:endCalled',
    ]) {
      expect(seen.get(name) ?? 0, name).toBeGreaterThan(0);
    }
  });
});
