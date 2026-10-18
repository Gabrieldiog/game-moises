import { describe, expect, it } from 'vitest';
import type { Card, ErrorCode, GameEvent, PlayerId, PowerKind, Suit } from '@moises/shared';
import { DEFAULT_RULES } from '../src/config/rules.js';
import { applyAction, buildDeck, createGame, scoreGrid, tick, type GameState } from '../src/engine/index.js';
import { SEED, T0, allCardsInState, c, facesIn, key, newGame, playing, visibleSlots, type TestGame } from './helpers.js';

// QA: adversarial review of the engine against docs/REGRAS.md.
// Everything here is written against the rules document, not against the
// implementation: expected values come from independent tables/oracles.

const G1 = ['2S', '3S', '4S', '5S'];
const G2 = ['2H', '3H', '4H', '5H'];
const G3 = ['2D', '3D', '4D', '5D'];

// --- scenario helpers ------------------------------------------------------------------

/** p1 draws `card`, discards it and lets the reaction window run out: the power step (if any). */
function atPowerStep(card: string, grids: string[][] = [G1, G2, G3]): TestGame {
  const game = playing({ grids, draws: [card] });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
  return game;
}

/** p1 draws and discards `card`: the reaction window is open. */
function windowOpen(card: string, grids: string[][] = [G1, G2, G3]): TestGame {
  const game = playing({ grids, draws: [card] });
  game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
  expect(game.state.reaction?.card).toEqual(c(card));
  return game;
}

/** p1 says "Estou foda" and everybody plays their last turn with draw + discard. */
function endedGame(grids: string[][]): TestGame {
  const game = playing({ grids });
  return finishWithCallEnd(game);
}

function finishWithCallEnd(game: TestGame): TestGame {
  game.act('p1', { type: 'callEnd' });
  for (let i = 0; i < 12 && game.state.phase === 'playing'; i++) game.drawAndDiscard(game.current as string);
  expect(game.state.phase).toBe('ended');
  return game;
}

/** Test-only state surgery: moves cards of a player's grid onto the discard pile (all 54 cards stay in the game). */
function takeCards(game: TestGame, playerId: string, slots: readonly number[]): void {
  const s = structuredClone(game.state);
  const player = s.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`setup: unknown player ${playerId}`);
  for (const slot of slots) {
    const card = player.grid[slot];
    if (!card) throw new Error(`setup: slot ${slot} of ${playerId} is already empty`);
    s.discardPile.push(card);
    player.grid[slot] = null;
  }
  game.state = s;
}

function keepOnlySlot0(game: TestGame, playerId: string): void {
  takeCards(game, playerId, [1, 2, 3]);
}

const codes = (game: TestGame, id: string) => game.grid(id).map((card) => card && key(card));

// --- 1. every action in every phase/step, for the current player and for someone else ----------

type Stage = 'arrange' | 'initialPeek' | 'draw' | 'decide' | 'reaction' | 'power' | 'powerSwap' | 'ended';

const STAGES: Record<Stage, () => TestGame> = {
  arrange: () => newGame({ grids: [G1, G2, G3] }),
  initialPeek: () => newGame({ grids: [G1, G2, G3] }).advanceTo(T0 + 5000),
  draw: () => playing({ grids: [G1, G2, G3] }),
  decide: () => playing({ grids: [G1, G2, G3], draws: ['5C'] }).act('p1', { type: 'draw' }),
  reaction: () => windowOpen('5C'),
  power: () => atPowerStep('7C'),
  powerSwap: () =>
    atPowerStep('JC').act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } }),
  ended: () => endedGame([G1, G2, G3]),
};

const SAMPLE_ACTIONS: Record<string, unknown> = {
  arrange: { type: 'arrange', fromSlot: 0, toSlot: 1 },
  draw: { type: 'draw' },
  swapWithDrawn: { type: 'swapWithDrawn', slot: 0 },
  discardDrawn: { type: 'discardDrawn' },
  callEnd: { type: 'callEnd' },
  usePower: { type: 'usePower', power: 'peekOwn', slot: 0 },
  powerSwap: { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } },
  skipPower: { type: 'skipPower' },
  matchOwn: { type: 'matchOwn', slot: 0 },
  matchOpponent: { type: 'matchOpponent', target: { playerId: 'p3', slot: 0 }, giveSlot: 0 },
};

/** What p1 (the player of the turn) may do in each stage. Everything else must be refused. */
const CURRENT_MAY: Record<Stage, string[]> = {
  arrange: ['arrange'],
  initialPeek: [],
  draw: ['draw', 'callEnd'],
  decide: ['swapWithDrawn', 'discardDrawn', 'callEnd'],
  reaction: ['callEnd', 'matchOwn', 'matchOpponent'],
  power: ['usePower', 'skipPower', 'callEnd'],
  powerSwap: ['powerSwap', 'skipPower', 'callEnd'],
  ended: [],
};

/** What p2 (not the player of the turn) may do. */
const OTHER_MAY: Record<Stage, string[]> = {
  arrange: ['arrange'],
  initialPeek: [],
  draw: [],
  decide: [],
  reaction: ['matchOwn', 'matchOpponent'],
  power: [],
  powerSwap: [],
  ended: [],
};

function expectedRefusal(stage: Stage, action: string, isCurrent: boolean): ErrorCode {
  if (stage === 'ended') return 'GAME_OVER';
  if (stage === 'arrange' || stage === 'initialPeek') return 'INVALID_PHASE';
  if (action === 'arrange') return 'INVALID_PHASE';
  if (action === 'matchOwn' || action === 'matchOpponent') return 'REACTION_WINDOW_CLOSED';
  return isCurrent ? 'INVALID_PHASE' : 'NOT_YOUR_TURN';
}

describe('out-of-turn / out-of-phase attacks: every action x every stage', () => {
  describe.each(Object.keys(STAGES) as Stage[])('stage "%s"', (stage) => {
    it.each(Object.keys(SAMPLE_ACTIONS))('%s', (name) => {
      const game = STAGES[stage]();
      const action = SAMPLE_ACTIONS[name];
      for (const [id, isCurrent] of [
        ['p1', true],
        ['p2', false],
      ] as const) {
        const allowed = (isCurrent ? CURRENT_MAY : OTHER_MAY)[stage].includes(name);
        if (allowed) {
          const result = applyAction(game.state, id, action, game.now);
          expect(result.ok, `${id} should be allowed to ${name} in stage ${stage}`).toBe(true);
        } else {
          // fail() also proves the state is untouched and that no state is returned.
          expect(game.fail(id, action), `${id} must be refused ${name} in stage ${stage}`).toBe(
            expectedRefusal(stage, name, isCurrent),
          );
        }
      }
    });
  });

  it('a stranger and a spectator can never act, in any stage', () => {
    for (const stage of Object.keys(STAGES) as Stage[]) {
      const game = STAGES[stage]();
      for (const action of Object.values(SAMPLE_ACTIONS)) {
        expect(game.fail('spectator', action)).toBe('UNKNOWN_PLAYER');
      }
    }
  });
});

// --- 2. power must match the discarded card ----------------------------------------------------

const POWER_CARD: Record<PowerKind, string> = {
  peekOwn: '7H',
  peekOpponent: '9S',
  blindSwap: 'QS',
  peekAndSwap: 'JH',
  peekManyAndSwap: 'KS',
};

const POWER_ATTEMPT: Record<PowerKind, unknown> = {
  peekOwn: { type: 'usePower', power: 'peekOwn', slot: 0 },
  peekOpponent: { type: 'usePower', power: 'peekOpponent', target: { playerId: 'p2', slot: 0 } },
  blindSwap: { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } },
  peekAndSwap: { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } },
  peekManyAndSwap: {
    type: 'usePower',
    power: 'peekManyAndSwap',
    targets: [
      { playerId: 'p2', slot: 0 },
      { playerId: 'p3', slot: 0 },
    ],
  },
};

describe('a power is only what the discarded card grants (5 x 5 matrix)', () => {
  const kinds = Object.keys(POWER_CARD) as PowerKind[];
  const pairs = kinds.flatMap((granted) => kinds.map((attempted) => [granted, attempted] as const));

  it.each(pairs)('card of %s: attempting %s', (granted, attempted) => {
    const game = atPowerStep(POWER_CARD[granted]);
    if (granted === attempted) {
      const result = applyAction(game.state, 'p1', POWER_ATTEMPT[attempted], game.now);
      expect(result.ok).toBe(true);
    } else {
      expect(game.fail('p1', POWER_ATTEMPT[attempted])).toBe('POWER_MISMATCH');
      // The refused attempt did not burn the power: the right one still works.
      const result = applyAction(game.state, 'p1', POWER_ATTEMPT[granted], game.now);
      expect(result.ok).toBe(true);
    }
  });

  it('7 and 8 can never look at an enemy card; 9 and 10 can never look at their own', () => {
    for (const card of ['7S', '8D']) {
      expect(atPowerStep(card).fail('p1', POWER_ATTEMPT.peekOpponent)).toBe('POWER_MISMATCH');
    }
    for (const card of ['9D', '10C']) {
      expect(atPowerStep(card).fail('p1', POWER_ATTEMPT.peekOwn)).toBe('POWER_MISMATCH');
    }
  });

  it('red kings and jokers grant nothing: there is no power step to use anything in', () => {
    for (const card of ['KH', 'KD', 'JKR', 'JKB']) {
      const game = atPowerStep(card);
      expect(game.current).toBe('p2');
      for (const attempt of Object.values(POWER_ATTEMPT)) expect(game.fail('p1', attempt)).toBe('NOT_YOUR_TURN');
    }
  });
});

// --- 3. malformed payloads, for every action and every nested field ----------------------------

type Path = readonly (string | number)[];

interface Shape {
  name: string;
  actor: PlayerId;
  setup: () => TestGame;
  /** A valid action for `actor` in the state `setup` builds. */
  action: Record<string, unknown>;
  /** Slot indexes into the actor's own grid. */
  ownSlots: Path[];
  /** SlotRef objects ({ playerId, slot }) naming cards of other players. */
  refs: Path[];
  /** powerSwap asks "was it peeked?" before it looks at the target itself. */
  refsMustBePeeked?: boolean;
}

const SHAPES: Shape[] = [
  {
    name: 'arrange',
    actor: 'p1',
    setup: () => newGame({ grids: [G1, G2, G3] }),
    action: { type: 'arrange', fromSlot: 0, toSlot: 1 },
    ownSlots: [['fromSlot'], ['toSlot']],
    refs: [],
  },
  { name: 'draw', actor: 'p1', setup: STAGES.draw, action: { type: 'draw' }, ownSlots: [], refs: [] },
  {
    name: 'swapWithDrawn',
    actor: 'p1',
    setup: STAGES.decide,
    action: { type: 'swapWithDrawn', slot: 1 },
    ownSlots: [['slot']],
    refs: [],
  },
  { name: 'discardDrawn', actor: 'p1', setup: STAGES.decide, action: { type: 'discardDrawn' }, ownSlots: [], refs: [] },
  { name: 'callEnd', actor: 'p1', setup: STAGES.draw, action: { type: 'callEnd' }, ownSlots: [], refs: [] },
  {
    name: 'usePower peekOwn',
    actor: 'p1',
    setup: () => atPowerStep('7C'),
    action: { type: 'usePower', power: 'peekOwn', slot: 1 },
    ownSlots: [['slot']],
    refs: [],
  },
  {
    name: 'usePower peekOpponent',
    actor: 'p1',
    setup: () => atPowerStep('9C'),
    action: { type: 'usePower', power: 'peekOpponent', target: { playerId: 'p2', slot: 1 } },
    ownSlots: [],
    refs: [['target']],
  },
  {
    name: 'usePower blindSwap',
    actor: 'p1',
    setup: () => atPowerStep('QC'),
    action: { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 1 } },
    ownSlots: [['ownSlot']],
    refs: [['target']],
  },
  {
    name: 'usePower peekAndSwap',
    actor: 'p1',
    setup: () => atPowerStep('JC'),
    action: { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 1 } },
    ownSlots: [],
    refs: [['target']],
  },
  {
    name: 'usePower peekManyAndSwap',
    actor: 'p1',
    setup: () => atPowerStep('KC'),
    action: {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 0 },
        { playerId: 'p3', slot: 1 },
      ],
    },
    ownSlots: [],
    refs: [['targets', 0], ['targets', 1]],
  },
  {
    name: 'powerSwap',
    actor: 'p1',
    setup: () =>
      atPowerStep('JC').act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 1 } }),
    action: { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 1 } },
    ownSlots: [['ownSlot']],
    refs: [['target']],
    refsMustBePeeked: true,
  },
  { name: 'skipPower', actor: 'p1', setup: STAGES.power, action: { type: 'skipPower' }, ownSlots: [], refs: [] },
  {
    name: 'matchOwn',
    actor: 'p2',
    setup: () => windowOpen('2C'),
    action: { type: 'matchOwn', slot: 0 },
    ownSlots: [['slot']],
    refs: [],
  },
  {
    name: 'matchOpponent',
    actor: 'p3',
    setup: () => windowOpen('2C'),
    action: { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 1 },
    ownSlots: [['giveSlot']],
    refs: [['target']],
  },
];

function pathSlots(shape: Shape): Path[] {
  return [...shape.ownSlots, ...shape.refs.map((ref) => [...ref, 'slot'] as Path)];
}

/** Copy of `root` with `value` set (as an own, enumerable property) at `path`. */
function setAt(root: Record<string, unknown>, path: Path, value: unknown): Record<string, unknown> {
  const copy = structuredClone(root);
  let node: unknown = copy;
  for (const step of path.slice(0, -1)) node = (node as Record<string | number, unknown>)[step];
  const last = path[path.length - 1] as string | number;
  Object.defineProperty(node as object, last, { value, enumerable: true, configurable: true, writable: true });
  return copy;
}

const BAD_SLOT_VALUES: unknown[] = [
  -1,
  -0.5,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  16, // one past the protocol maximum (15)
  2 ** 31,
  Number.MAX_SAFE_INTEGER,
  '0',
  '',
  null,
  undefined,
  true,
  [0],
  { valueOf: () => 0 },
];

const BAD_PLAYER_IDS: unknown[] = ['', 'x'.repeat(65), 'p 1', 'p2;', '../p2', 'p2\n', 42, null, undefined, {}, ['p2'], true];

const EXTRA_KEYS: [string, unknown][] = [
  ['card', { kind: 'standard', rank: 'K', suit: 'hearts' }],
  ['rank', 'K'],
  ['value', -100],
  ['playerId', 'p2'],
  ['score', 0],
  ['isAdmin', true],
  ['__proto__', { isAdmin: true }],
  ['constructor', { prototype: { isAdmin: true } }],
];

describe.each(SHAPES)('payload attacks: $name', (shape) => {
  it('sanity: the untouched action is accepted in its own stage', () => {
    const game = shape.setup();
    const result = applyAction(game.state, shape.actor, shape.action, game.now);
    expect(result.ok, JSON.stringify(shape.action)).toBe(true);
  });

  it('negative, fractional, NaN, huge, string, null and missing slot indexes are INVALID_ACTION', () => {
    const game = shape.setup();
    for (const path of pathSlots(shape)) {
      for (const bad of BAD_SLOT_VALUES) {
        const code = game.fail(shape.actor, setAt(shape.action, path, bad));
        expect(code, `${path.join('.')} = ${String(bad)}`).toBe('INVALID_ACTION');
      }
    }
  });

  it('slots inside the protocol range but outside the 2x2 grid are refused by the rules', () => {
    const game = shape.setup();
    const ownPaths = new Set(shape.ownSlots.map((path) => path.join('.')));
    for (const path of pathSlots(shape)) {
      const expected: ErrorCode =
        shape.refsMustBePeeked && !ownPaths.has(path.join('.')) ? 'TARGET_NOT_PEEKED' : 'INVALID_SLOT';
      for (const outside of [4, 5, 15]) {
        expect(game.fail(shape.actor, setAt(shape.action, path, outside)), `${path.join('.')} = ${outside}`).toBe(expected);
      }
    }
  });

  it('player ids: malformed ids are INVALID_ACTION; unknown, "__proto__" and yourself are never a valid target', () => {
    const game = shape.setup();
    const refusal: ErrorCode = shape.refsMustBePeeked ? 'TARGET_NOT_PEEKED' : 'INVALID_TARGET';
    for (const ref of shape.refs) {
      const idPath = [...ref, 'playerId'];
      for (const bad of BAD_PLAYER_IDS) {
        expect(game.fail(shape.actor, setAt(shape.action, idPath, bad)), `${idPath.join('.')} = ${String(bad)}`).toBe('INVALID_ACTION');
      }
      for (const unknown of ['ghost', 'P2', '__proto__', 'constructor', 'toString']) {
        expect(game.fail(shape.actor, setAt(shape.action, idPath, unknown)), `${idPath.join('.')} = ${unknown}`).toBe(refusal);
      }
      // The target must be an ENEMY: yourself is refused for every power/reaction that names a card.
      expect(game.fail(shape.actor, setAt(shape.action, idPath, shape.actor)), `${idPath.join('.')} = self`).toBe(refusal);
    }
  });

  it('extra fields are rejected at the top level and inside every nested object', () => {
    const game = shape.setup();
    for (const [extraKey, extraValue] of EXTRA_KEYS) {
      expect(game.fail(shape.actor, setAt(shape.action, [extraKey], extraValue)), `top-level ${extraKey}`).toBe('INVALID_ACTION');
      if (extraKey === 'playerId') continue; // a legitimate key inside a SlotRef, so not "extra" there
      for (const ref of shape.refs) {
        expect(game.fail(shape.actor, setAt(shape.action, [...ref, extraKey], extraValue)), `${ref.join('.')}.${extraKey}`).toBe(
          'INVALID_ACTION',
        );
      }
    }
  });
});

describe('payload attacks: shape and size', () => {
  it('peekManyAndSwap with zero, too many or non-array targets is INVALID_ACTION', () => {
    const game = atPowerStep('KC');
    const use = (targets: unknown) => ({ type: 'usePower', power: 'peekManyAndSwap', targets });
    const ref = (slot: number) => ({ playerId: 'p2', slot });
    expect(game.fail('p1', use([]))).toBe('INVALID_ACTION');
    expect(game.fail('p1', use(Array.from({ length: 9 }, (_, i) => ref(i % 4))))).toBe('INVALID_ACTION');
    expect(game.fail('p1', use(ref(0)))).toBe('INVALID_ACTION');
    expect(game.fail('p1', use(null))).toBe('INVALID_ACTION');
    expect(game.fail('p1', use([null, ref(0)]))).toBe('INVALID_ACTION');
  });

  it('a target must be an object with exactly playerId and slot', () => {
    const game = atPowerStep('9C');
    const peek = (target: unknown) => ({ type: 'usePower', power: 'peekOpponent', target });
    for (const target of [null, 'p2', 7, [], ['p2', 0], {}, { playerId: 'p2' }, { slot: 0 }, { playerId: 'p2', slot: 0, extra: 1 }]) {
      expect(game.fail('p1', peek(target)), JSON.stringify(target)).toBe('INVALID_ACTION');
    }
  });

  it('the action type is case- and whitespace-sensitive, and unknown powers are refused', () => {
    const game = atPowerStep('7C');
    for (const type of ['DRAW', 'Draw', ' draw', 'draw ', 'usepower', 'constructor', '__proto__', 'toString', '']) {
      expect(game.fail('p1', { type }), type).toBe('INVALID_ACTION');
    }
    for (const power of ['peekall', 'PEEKOWN', 'peekOwn ', '', 'constructor']) {
      expect(game.fail('p1', { type: 'usePower', power, slot: 0 }), power).toBe('INVALID_ACTION');
    }
  });

  it('an action smuggling another player id cannot act as that player', () => {
    const game = playing({ grids: [G1, G2, G3] });
    expect(game.fail('p2', { type: 'draw', playerId: 'p1' })).toBe('INVALID_ACTION');
    expect(game.fail('p1', { type: 'draw', playerId: 'p2' })).toBe('INVALID_ACTION');
    expect(game.fail('p2', { type: 'callEnd', player: 'p1' })).toBe('INVALID_ACTION');
  });
});

// --- 4. powers: look-at-most-once, swap-at-most-one, and nobody else gets a power ---------------

describe('J and black K: the peek happens once and at most one card changes owner', () => {
  const kPeek = () =>
    atPowerStep('KS').act('p1', {
      type: 'usePower',
      power: 'peekManyAndSwap',
      targets: [
        { playerId: 'p2', slot: 1 },
        { playerId: 'p3', slot: 3 },
      ],
    });

  it('while deciding the swap, usePower is refused: no extra peeks by repeating the power', () => {
    const game = kPeek();
    const before = visibleSlots(game.view('p1'));
    expect(before).toEqual({ p1: {}, p2: { 1: '3:hearts' }, p3: { 3: '5:diamonds' } });
    expect(game.fail('p1', POWER_ATTEMPT.peekManyAndSwap)).toBe('INVALID_PHASE');
    expect(game.fail('p1', { type: 'usePower', power: 'peekManyAndSwap', targets: [{ playerId: 'p2', slot: 0 }, { playerId: 'p3', slot: 0 }] })).toBe(
      'INVALID_PHASE',
    );
    expect(game.fail('p1', POWER_ATTEMPT.peekOpponent)).toBe('INVALID_PHASE');
    expect(visibleSlots(game.view('p1'))).toEqual(before);
  });

  it('K: after one swap the turn is over; the other peeked card cannot be swapped as well', () => {
    const game = kPeek();
    game.act('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 1 } });
    expect(game.grid('p1')[0]).toEqual(c('3H'));
    expect(game.grid('p2')[1]).toEqual(c('2S'));
    expect(game.current).toBe('p2');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 1, target: { playerId: 'p3', slot: 3 } })).toBe('NOT_YOUR_TURN');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 1 } })).toBe('NOT_YOUR_TURN');
    expect(game.grid('p3')[3]).toEqual(c('5D'));
    expect(game.grid('p1')[1]).toEqual(c('3S'));
  });

  it('J: usePower cannot be repeated after the first look, and the swap is a single swap', () => {
    const game = atPowerStep('JS').act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    expect(game.fail('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p3', slot: 0 } })).toBe('INVALID_PHASE');
    expect(visibleSlots(game.view('p1')).p3).toEqual({});
    game.act('p1', { type: 'powerSwap', ownSlot: 2, target: { playerId: 'p2', slot: 0 } });
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 3, target: { playerId: 'p2', slot: 0 } })).toBe('NOT_YOUR_TURN');
  });

  it('the swap needs a card of your own to give: an emptied slot is refused', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['JS'] });
    takeCards(game, 'p1', [2]);
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' }).closeWindow();
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 2, target: { playerId: 'p2', slot: 0 } })).toBe('EMPTY_SLOT');
    game.act('p1', { type: 'powerSwap', ownSlot: 3, target: { playerId: 'p2', slot: 0 } });
    expect(game.grid('p1')[3]).toEqual(c('2H'));
  });

  it('a skipped swap keeps every card where it was', () => {
    const game = kPeek();
    game.act('p1', { type: 'skipPower' });
    expect(codes(game, 'p1')).toEqual(G1.map((code) => key(c(code))));
    expect(codes(game, 'p2')).toEqual(G2.map((code) => key(c(code))));
    expect(codes(game, 'p3')).toEqual(G3.map((code) => key(c(code))));
  });
});

describe('Q: blind swap — nobody sees anything, not even through events', () => {
  it('no view and no event carries a card face other than the public discard', () => {
    const game = atPowerStep('QS');
    game.act('p1', { type: 'usePower', power: 'blindSwap', ownSlot: 1, target: { playerId: 'p3', slot: 2 } });
    expect(game.grid('p1')[1]).toEqual(c('4D'));
    expect(game.grid('p3')[2]).toEqual(c('3S'));
    expect(game.lastEvents.map((event) => event.type)).toEqual(['powerUsed', 'turnStarted']);
    expect(facesIn(game.lastEvents)).toEqual([]);
    expect(game.state.reveals).toEqual([]);
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      expect(facesIn(game.view(viewer)), viewer).toEqual(['Q:spades']);
    }
  });

  it('keeps hands the same size, on both sides', () => {
    const game = atPowerStep('QH');
    game.act('p1', { type: 'usePower', power: 'blindSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } });
    for (const id of ['p1', 'p2', 'p3']) expect(game.view('p3').players.find((p) => p.id === id)?.cardCount).toBe(4);
  });
});

describe('power only for a card that was drawn and discarded', () => {
  it('a power card used to REACT (matchOwn) gives the reactor nothing; the discarder keeps theirs', () => {
    const game = playing({ grids: [G1, ['QH', '3H', '4H', '5H'], G3], draws: ['QC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.state.discardPile.slice(-2)).toEqual([c('QC'), c('QH')]);
    expect(game.lastEvents.filter((event) => event.type === 'powerAvailable')).toEqual([
      { type: 'powerAvailable', playerId: 'p1', power: 'blindSwap' },
    ]);
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'power', pendingPower: 'blindSwap' });
    game.act('p1', { type: 'skipPower' });
    expect(game.state.turn).toMatchObject({ playerId: 'p2', step: 'draw', pendingPower: null });
  });

  it('a black K used to react to a red K (no power) does not wake any power', () => {
    const game = playing({ grids: [G1, ['KS', '3H', '4H', '5H'], G3], draws: ['KH'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p2', { type: 'matchOwn', slot: 0 });
    expect(game.lastEvents.some((event) => event.type === 'powerAvailable')).toBe(false);
    expect(game.state.turn).toMatchObject({ playerId: 'p2', step: 'draw', pendingPower: null });
  });

  it('a power card taken from an enemy by "filho da puta" gives the reactor nothing either', () => {
    const game = playing({ grids: [G1, ['JH', '3H', '4H', '5H'], G3], draws: ['JC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 0 });
    expect(game.state.discardPile.at(-1)).toEqual(c('JH'));
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'power', pendingPower: 'peekAndSwap' });
    game.act('p1', { type: 'skipPower' });
    expect(game.current).toBe('p2');
  });

  it('swapping a power card in, then discarding other cards, never revives a power from the grid', () => {
    const game = playing({ grids: [G1, G2, G3], draws: ['9C', 'AC'] });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 0 }).closeWindow(); // 9C goes into the grid
    game.drawAndDiscard('p2');
    game.act('p3', { type: 'draw' }).act('p3', { type: 'discardDrawn' }).closeWindow();
    if (game.state.turn?.step === 'power') game.act('p3', { type: 'skipPower' });
    game.act('p1', { type: 'draw' }).act('p1', { type: 'swapWithDrawn', slot: 0 }); // 9C leaves the grid
    expect(game.state.discardPile.at(-1)).toEqual(c('9C'));
    game.closeWindow();
    expect(game.current).toBe('p2');
    expect(game.state.turn?.pendingPower).toBeNull();
  });
});

// --- 5. reactions: wrong guesses and the clock ---------------------------------------------------

describe('wrong reaction: the reveal lasts revealMs, also after the window closes', () => {
  it('matchOpponent: the card that was going to be handed over stays visible to all until revealMs', () => {
    const game = windowOpen('6C');
    const opened = game.now;
    game.advance(2000);
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 1 }); // 2H is not a 6
    const everyone = ['p1', 'p2', 'p3', 'spectator'];
    for (const viewer of everyone) expect(visibleSlots(game.view(viewer)).p3, viewer).toEqual({ 1: '3:diamonds' });
    expect(codes(game, 'p2')).toEqual(G2.map((code) => key(c(code))));
    expect(codes(game, 'p3')).toEqual(G3.map((code) => key(c(code))));

    game.advanceTo(opened + 3000); // the window closes, the reveal goes on
    expect(game.state.reaction).toBeNull();
    expect(game.current).toBe('p2');
    for (const viewer of everyone) expect(visibleSlots(game.view(viewer)).p3, viewer).toEqual({ 1: '3:diamonds' });

    game.advanceTo(opened + 4999);
    for (const viewer of everyone) expect(visibleSlots(game.view(viewer)).p3, viewer).toEqual({ 1: '3:diamonds' });
    game.advanceTo(opened + 5000);
    for (const viewer of everyone) expect(visibleSlots(game.view(viewer)).p3, viewer).toEqual({});
    expect(game.state.reveals).toEqual([]);
  });

  it('matchOwn: same, and the revealed card is the one the reactor tried to discard', () => {
    const game = windowOpen('6C');
    const opened = game.now;
    game.advance(2500);
    game.act('p2', { type: 'matchOwn', slot: 3 }); // 5H is not a 6
    game.advanceTo(opened + 3000);
    for (const viewer of ['p1', 'p3', 'spectator']) expect(visibleSlots(game.view(viewer)).p2, viewer).toEqual({ 3: '5:hearts' });
    game.advanceTo(opened + 5499);
    expect(visibleSlots(game.view('p1')).p2).toEqual({ 3: '5:hearts' });
    game.advanceTo(opened + 5500);
    expect(visibleSlots(game.view('p1')).p2).toEqual({});
  });

  it('a wrong guess never lets the enemy card be seen, even by the reactor', () => {
    const game = windowOpen('6C');
    game.act('p3', { type: 'matchOpponent', target: { playerId: 'p2', slot: 0 }, giveSlot: 1 });
    for (const viewer of ['p1', 'p2', 'p3', 'spectator']) {
      expect(facesIn(game.view(viewer))).not.toContain('2:hearts');
    }
    expect(facesIn(game.lastEvents)).toEqual(['3:diamonds']);
  });
});

// --- 6. "Estou foda": every table size, every caller seat ---------------------------------------

describe('"Estou foda": everybody else plays exactly one more turn, in seat order, the caller never again', () => {
  const seatsAfter = (ids: string[], id: string) => {
    const at = ids.indexOf(id);
    return ids.map((_, i) => ids[(at + 1 + i) % ids.length] as string).slice(0, ids.length - 1);
  };

  for (const n of [2, 3, 4, 5, 6]) {
    it(`${n} players, called by each seat`, () => {
      const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].slice(0, n);
      for (const caller of ids) {
        // Distinct hands from the canonical deck; the exact cards do not matter here.
        const dealt = buildDeck(DEFAULT_RULES).map(codeOf);
        const grids = ids.map((_, i) => dealt.slice(i * 4, i * 4 + 4));
        const game = playing({ grids, first: caller });
        game.act(caller, { type: 'callEnd' });
        const order: string[] = [];
        for (let i = 0; i < 12 && game.state.phase === 'playing'; i++) {
          order.push(game.current as string);
          game.drawAndDiscard(game.current as string);
        }
        expect(order, `caller ${caller}`).toEqual([caller, ...seatsAfter(ids, caller)]);
        expect(game.state.phase).toBe('ended');
        expect(game.state.result?.reason).toBe('endCalled');
      }
    });
  }

  it('the caller of the end cannot use the rest of his turn to extend the game: nothing starts after the last turn', () => {
    const game = playing({ grids: [G1, G2], draws: ['AC', '7C'] });
    game.act('p1', { type: 'callEnd' });
    game.drawAndDiscard('p1');
    game.act('p2', { type: 'draw' }).act('p2', { type: 'discardDrawn' }).closeWindow(); // 7C: p2 still has a power
    expect(game.state.phase).toBe('playing');
    expect(game.state.turn).toMatchObject({ playerId: 'p2', step: 'power' });
    game.act('p2', { type: 'skipPower' });
    expect(game.state.phase).toBe('ended');
    expect(game.state.turn).toBeNull();
  });
});

describe('a player left without cards, while holding a power', () => {
  it('7 / 8: the power has nothing to look at and is skipped; the end is triggered', () => {
    const game = playing({ grids: [['7S', '3S', '4S', '5S'], G2, G3], draws: ['7C'] });
    keepOnlySlot0(game, 'p1');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p1', { type: 'matchOwn', slot: 0 });
    expect(game.lastEvents).toContainEqual({ type: 'powerSkipped', playerId: 'p1', power: 'peekOwn', reason: 'unusable' });
    expect(game.state.endCall).toEqual({ callerId: 'p1', reason: 'noCards', pending: ['p2', 'p3'] });
    expect(game.current).toBe('p2');
  });

  it('J: still looks at an enemy card, but with nothing to give the turn ends at once', () => {
    const game = playing({ grids: [['JS', '3S', '4S', '5S'], G2, G3], draws: ['JC'] });
    keepOnlySlot0(game, 'p1');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p1', { type: 'matchOwn', slot: 0 });
    expect(game.state.turn).toMatchObject({ playerId: 'p1', step: 'power', pendingPower: 'peekAndSwap' });
    game.act('p1', { type: 'usePower', power: 'peekAndSwap', target: { playerId: 'p2', slot: 0 } });
    expect(visibleSlots(game.view('p1')).p2).toEqual({ 0: '2:hearts' });
    expect(game.current).toBe('p2');
    expect(game.fail('p1', { type: 'powerSwap', ownSlot: 0, target: { playerId: 'p2', slot: 0 } })).toBe('NOT_YOUR_TURN');
  });

  it('Q: with no card of his own the blind swap is skipped', () => {
    const game = playing({ grids: [['QS', '3S', '4S', '5S'], G2, G3], draws: ['QC'] });
    keepOnlySlot0(game, 'p1');
    game.act('p1', { type: 'draw' }).act('p1', { type: 'discardDrawn' });
    game.act('p1', { type: 'matchOwn', slot: 0 });
    expect(game.lastEvents).toContainEqual({ type: 'powerSkipped', playerId: 'p1', power: 'blindSwap', reason: 'unusable' });
    expect(game.current).toBe('p2');
  });
});

// --- 7. scoring against an independent table ------------------------------------------------------

const FACE_VALUE: Record<string, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
};

/** REGRAS.md: A=1 ... 10, J=11, Q=12, black K=13, red K=-1, joker=0. */
function oracleValue(card: Card): number {
  if (card.kind === 'joker') return 0;
  if (card.rank === 'K') return card.suit === 'hearts' || card.suit === 'diamonds' ? -1 : 13;
  return FACE_VALUE[card.rank] as number;
}

const SUIT_LETTER: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

function codeOf(card: Card): string {
  if (card.kind === 'joker') return card.color === 'red' ? 'JKR' : 'JKB';
  return `${card.rank}${SUIT_LETTER[card.suit]}`;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('scoring', () => {
  const deck = buildDeck(DEFAULT_RULES);

  it('every one of the 54 faces scores what REGRAS.md says', () => {
    expect(deck).toHaveLength(54);
    for (const card of deck) {
      expect(scoreGrid([card, null, null, null], DEFAULT_RULES), codeOf(card)).toBe(oracleValue(card));
    }
    expect(deck.filter((card) => oracleValue(card) === -1).map(codeOf).sort()).toEqual(['KD', 'KH']);
    expect(deck.filter((card) => oracleValue(card) === 13).map(codeOf).sort()).toEqual(['KC', 'KS']);
    expect(deck.filter((card) => oracleValue(card) === 0).map(codeOf).sort()).toEqual(['JKB', 'JKR']);
  });

  it('a player with no cards scores 0: he beats positive totals but loses to a negative one', () => {
    const grids = [G1, ['KH', 'KD', 'JKR', 'JKB'], G3];
    const game = playing({ grids });
    takeCards(game, 'p1', [0, 1, 2, 3]);
    finishWithCallEnd(game);
    expect(game.state.result?.scores.map((s) => s.total)).toEqual([0, -2, 14]);
    expect(game.state.result?.winners).toEqual(['p2']);

    const other = playing({ grids: [G1, G2, G3] });
    takeCards(other, 'p1', [0, 1, 2, 3]);
    finishWithCallEnd(other);
    expect(other.state.result?.winners).toEqual(['p1']);
  });

  it('ties: everybody with the lowest total wins, including an empty hand and a 0-point hand', () => {
    const game = playing({ grids: [G1, G2, ['JKR', 'JKB', 'KH', 'AS']] }); // third = 0
    takeCards(game, 'p1', [0, 1, 2, 3]);
    takeCards(game, 'p2', [0, 1, 2]);
    finishWithCallEnd(game);
    // p1: 0, p2: 5 (only 5H), p3: 0
    expect(game.state.result?.scores.map((s) => s.total)).toEqual([0, 5, 0]);
    expect(game.state.result?.winners).toEqual(['p1', 'p3']);
  });

  it('everybody tied: everybody wins', () => {
    const game = endedGame([
      ['AS', '2S', '3S', '4S'],
      ['AH', '2H', '3H', '4H'],
      ['AD', '2D', '3D', '4D'],
    ]);
    expect(game.state.result?.winners).toEqual(['p1', 'p2', 'p3']);
  });
});

// --- 8. fuzz with independent oracles -------------------------------------------------------------

/** "Mesmo número" written from REGRAS.md, not from the engine (jokers match each other by default). */
function oracleSameRank(a: Card, b: Card): boolean {
  if (a.kind === 'joker' || b.kind === 'joker') return a.kind === 'joker' && b.kind === 'joker';
  return a.rank === b.rank;
}

const countCards = (grid: readonly (Card | null)[]) => grid.filter((slot) => slot !== null).length;

interface ReactionMove {
  id: PlayerId;
  action: { type: 'matchOwn'; slot: number } | { type: 'matchOpponent'; target: { playerId: PlayerId; slot: number }; giveSlot: number };
  right: boolean;
}

describe('fuzz: random full games checked against independent oracles', () => {
  const stats = {
    called: 0,
    noCardsDuringOwnTurn: 0,
    noCardsDuringOtherTurn: 0,
    lateAttempts: 0,
    rightOwn: 0,
    rightOpponent: 0,
    wrong: 0,
    boundaryRight: 0,
  };

  it.each(Array.from({ length: 36 }, (_, i) => i))('game #%i', (index) => {
    const rand = prng(90_000 + index);
    const pick = <T,>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('fuzz bug: picking from nothing');
      return items[Math.floor(rand() * items.length)] as T;
    };
    const n = 2 + (index % 5);
    const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
    const created = createGame({
      players: ids.map((id) => ({ id, name: id.toUpperCase() })),
      seed: `${SEED}-qa-${index}`,
      now: T0,
    });
    if (!created.ok) throw new Error(`createGame failed: ${created.error.message}`);
    let state: GameState = created.state;
    let now = T0;
    const log: GameEvent[] = [...created.events];

    const checkState = () => {
      const cards = allCardsInState(state);
      expect(cards).toHaveLength(54);
      expect(new Set(cards).size).toBe(54);
      for (const player of state.players) expect(player.grid).toHaveLength(4);
    };
    const advanceTo = (t: number) => {
      now = Math.max(now, t);
      const ticked = tick(state, now);
      state = ticked.state;
      log.push(...ticked.events);
      checkState();
    };
    const attempt = (id: string, action: unknown) => {
      const before = structuredClone(state);
      const result = applyAction(state, id, action, now);
      if (result.ok) {
        state = result.state;
        log.push(...result.events);
        checkState();
      } else {
        expect(state).toEqual(before);
      }
      return result;
    };
    const mustWork = (id: string, action: unknown) => {
      const result = attempt(id, action);
      if (!result.ok) {
        throw new Error(`legal action refused: ${JSON.stringify(action)} by ${id}: ${result.error.code} ${result.error.message}`);
      }
      return result;
    };
    const occupied = (id: string) =>
      (state.players.find((p) => p.id === id)?.grid ?? []).flatMap((slot, i) => (slot ? [i] : []));
    const enemyCards = (me: string) =>
      state.players.flatMap((p) => (p.id === me ? [] : occupied(p.id).map((slot) => ({ playerId: p.id, slot }))));

    const reactionMove = (): ReactionMove | null => {
      const reaction = state.reaction;
      if (!reaction) return null;
      const tried = new Set(reaction.attempts);
      const rights: ReactionMove[] = [];
      const wrongs: ReactionMove[] = [];
      for (const p of state.players) {
        if (tried.has(p.id)) continue;
        const give = p.grid.findIndex((slot) => slot !== null);
        p.grid.forEach((slot, i) => {
          if (!slot) return;
          (oracleSameRank(slot, reaction.card) ? rights : wrongs).push({ id: p.id, action: { type: 'matchOwn', slot: i }, right: oracleSameRank(slot, reaction.card) });
        });
        if (give < 0) continue;
        for (const other of state.players) {
          if (other.id === p.id) continue;
          other.grid.forEach((slot, i) => {
            if (!slot) return;
            const right = oracleSameRank(slot, reaction.card);
            (right ? rights : wrongs).push({
              id: p.id,
              action: { type: 'matchOpponent', target: { playerId: other.id, slot: i }, giveSlot: give },
              right,
            });
          });
        }
      }
      if (rights.length > 0 && (wrongs.length === 0 || rand() < 0.75)) return pick(rights);
      return wrongs.length > 0 ? pick(wrongs) : null;
    };

    /** Plays one reaction and checks the outcome against REGRAS.md. Returns false if nobody could react. */
    const react = (): boolean => {
      const move = reactionMove();
      if (!move) return false;
      const before = state;
      const turnBefore = before.turn?.playerId;
      const reactorBefore = before.players.find((p) => p.id === move.id)?.grid ?? [];
      const result = mustWork(move.id, move.action);
      const after = result.state;
      const types = result.events.map((e) => e.type);
      const reactorAfter = after.players.find((p) => p.id === move.id)?.grid ?? [];
      if (move.right) {
        expect(types).toContain('reactionSucceeded');
        expect(types).toContain('reactionWindowClosed'); // first right reaction wins: the window is over
        expect(after.reaction).toBeNull();
        expect(countCards(reactorAfter)).toBe(countCards(reactorBefore) - 1);
        if (move.action.type === 'matchOwn') {
          stats.rightOwn++;
          expect(reactorAfter[move.action.slot]).toBeNull();
          expect(after.discardPile.at(-1)).toEqual(reactorBefore[move.action.slot]);
        } else {
          stats.rightOpponent++;
          const { target, giveSlot } = move.action;
          const targetBefore = before.players.find((p) => p.id === target.playerId)?.grid ?? [];
          const targetAfter = after.players.find((p) => p.id === target.playerId)?.grid ?? [];
          expect(countCards(targetAfter)).toBe(countCards(targetBefore)); // the enemy keeps the same number of cards
          expect(after.discardPile.at(-1)).toEqual(targetBefore[target.slot]); // his card goes to the discard
          expect(targetAfter[target.slot]).toEqual(reactorBefore[giveSlot]); // one of mine takes its place
          expect(reactorAfter[giveSlot]).toBeNull();
        }
        const noCards = result.events.find((e) => e.type === 'endCalled' && e.reason === 'noCards');
        if (noCards) {
          expect(countCards(reactorAfter)).toBe(0);
          if (turnBefore === move.id) stats.noCardsDuringOwnTurn++;
          else stats.noCardsDuringOtherTurn++;
        }
      } else {
        stats.wrong++;
        expect(types).toEqual(['reactionFailed']); // nothing else happens
        expect(after.players).toEqual(before.players); // nothing moves
        expect(after.discardPile).toEqual(before.discardPile);
        expect(after.reaction).not.toBeNull(); // a wrong guess does not close the window
        const failed = result.events[0];
        const shown = move.action.type === 'matchOwn' ? reactorBefore[move.action.slot] : reactorBefore[move.action.giveSlot];
        if (failed?.type !== 'reactionFailed') throw new Error('expected reactionFailed');
        expect(failed.revealed).toEqual(shown); // the reactor's own card, never the enemy's
      }
      return true;
    };

    // Half of the games start with hands trimmed to 1-2 cards, so that "sem cartas" happens often.
    let trimmed = false;
    const trimHands = () => {
      const s = structuredClone(state);
      for (const player of s.players) {
        const keep = 1 + Math.floor(rand() * 2);
        const slots = player.grid.flatMap((card, i) => (card ? [i] : []));
        while (slots.length > keep) {
          const [slot] = slots.splice(Math.floor(rand() * slots.length), 1) as [number];
          s.discardPile.push(player.grid[slot] as Card);
          player.grid[slot] = null;
        }
      }
      state = s;
      checkState();
    };

    let steps = 0;
    while (state.phase !== 'ended' && steps++ < 6000) {
      if (state.phase === 'playing' && !trimmed) {
        trimmed = true;
        if (index % 2 === 0) trimHands();
      }
      if (state.phase === 'arrange' || state.phase === 'initialPeek') {
        if (state.phase === 'arrange' && rand() < 0.6) {
          attempt(pick(ids), { type: 'arrange', fromSlot: Math.floor(rand() * 4), toSlot: Math.floor(rand() * 4) });
        }
        advanceTo(state.phaseDeadline as number);
        continue;
      }
      const turn = state.turn;
      if (!turn) throw new Error('playing without a turn');
      const me = turn.playerId;

      const reaction = state.reaction;
      if (reaction) {
        const r = rand();
        if (r < 0.6) {
          if (rand() < 0.3 && now < reaction.deadline - 1) {
            advanceTo(reaction.deadline - 1); // the very last millisecond still counts
            const stillOpen = state.reaction !== null;
            expect(stillOpen).toBe(true);
            if (react()) stats.boundaryRight++;
          } else {
            react();
          }
          continue;
        }
        if (r < 0.68 && !state.endCall) {
          mustWork(me, { type: 'callEnd' });
          continue;
        }
        if (r < 0.78) {
          // At the deadline the window is closed, whoever tries and whatever they try.
          const late = applyAction(state, pick(ids), { type: 'matchOwn', slot: 0 }, reaction.deadline);
          expect(late.ok).toBe(false);
          if (!late.ok) expect(['REACTION_WINDOW_CLOSED', 'GAME_OVER']).toContain(late.error.code);
          stats.lateAttempts++;
        }
        advanceTo(reaction.deadline);
        continue;
      }

      switch (turn.step) {
        case 'draw':
          if (!state.endCall && state.turnCount > 8 && rand() < 0.12) mustWork(me, { type: 'callEnd' });
          else mustWork(me, { type: 'draw' });
          break;
        case 'decide':
          if (occupied(me).length > 0 && rand() < 0.45) mustWork(me, { type: 'swapWithDrawn', slot: pick(occupied(me)) });
          else mustWork(me, { type: 'discardDrawn' });
          break;
        case 'power': {
          const power = turn.pendingPower as PowerKind;
          if (rand() < 0.2) {
            mustWork(me, { type: 'skipPower' });
          } else if (power === 'peekOwn') {
            mustWork(me, { type: 'usePower', power, slot: pick(occupied(me)) });
          } else if (power === 'peekOpponent' || power === 'peekAndSwap') {
            mustWork(me, { type: 'usePower', power, target: pick(enemyCards(me)) });
          } else if (power === 'blindSwap') {
            mustWork(me, { type: 'usePower', power, ownSlot: pick(occupied(me)), target: pick(enemyCards(me)) });
          } else {
            const enemies = enemyCards(me);
            const first = pick(enemies);
            const rest = enemies.filter((e) => e.playerId !== first.playerId || e.slot !== first.slot);
            const targets = rest.length > 0 ? [first, pick(rest)] : [first];
            mustWork(me, { type: 'usePower', power, targets });
          }
          break;
        }
        case 'powerSwap':
          if (rand() < 0.4) mustWork(me, { type: 'skipPower' });
          else mustWork(me, { type: 'powerSwap', ownSlot: pick(occupied(me)), target: pick(turn.peeked) });
          break;
        case 'reaction':
          throw new Error('fuzz bug: reaction step without a window');
      }
    }

    expect(state.phase).toBe('ended');
    const result = state.result;
    if (!result) throw new Error('ended without a result');

    // Independent scoring.
    const totals = state.players.map((p) => p.grid.reduce((sum, slot) => sum + (slot ? oracleValue(slot) : 0), 0));
    expect(result.scores.map((s) => s.total)).toEqual(totals);
    const best = Math.min(...totals);
    expect(result.winners).toEqual(ids.filter((_, i) => totals[i] === best));

    // Independent turn-order oracle: normal rotation, then the end-of-game rule.
    const after = (id: string) => ids[(ids.indexOf(id) + 1) % ids.length] as string;
    let current: string | null = null;
    let expectedLeft: string[] | null = null;
    let lastEvent: GameEvent | undefined;
    for (const event of log) {
      expect(lastEvent?.type, 'nothing may follow the end of the game').not.toBe('gameEnded');
      lastEvent = event;
      if (event.type === 'turnStarted') {
        if (expectedLeft === null) {
          expect(event.playerId).toBe(current === null ? created.state.firstPlayerId : after(current));
        } else {
          // After the call: the other players, once each, in seat order starting after the player whose turn it was.
          expect(event.playerId).toBe(expectedLeft.shift());
        }
        current = event.playerId;
      }
      if (event.type === 'endCalled') {
        const caller = event.playerId;
        const inProgress = current as string;
        expectedLeft = [];
        for (let id = after(inProgress); id !== inProgress; id = after(id)) if (id !== caller) expectedLeft.push(id);
        if (event.reason === 'called') {
          stats.called++;
          expect(caller).toBe(inProgress); // "Estou foda" is only said in your own turn
        }
      }
    }
    expect(lastEvent?.type).toBe('gameEnded');
    if (result.reason === 'endCalled') expect(expectedLeft).toEqual([]);
  });

  it('the fuzz really exercised the rules it claims to check', () => {
    expect(stats.called).toBeGreaterThan(3);
    expect(stats.noCardsDuringOwnTurn).toBeGreaterThan(0);
    expect(stats.noCardsDuringOtherTurn).toBeGreaterThan(0);
    expect(stats.lateAttempts).toBeGreaterThan(5);
    expect(stats.rightOwn).toBeGreaterThan(10);
    expect(stats.rightOpponent).toBeGreaterThan(3);
    expect(stats.wrong).toBeGreaterThan(5);
    expect(stats.boundaryRight).toBeGreaterThan(2);
  });
});
