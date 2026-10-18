import type {
  Card,
  GameResult,
  GameView,
  PlayerId,
  PlayerView,
  PowerKind,
  Rank,
  SlotRef,
  SlotView,
  Suit,
  TurnView,
} from '@moises/shared';

// Demo fixtures: GameViews as the server would send them at each moment of a
// match, for 2 to 6 players. They are MOCK SERVER DATA, used by the local mock
// connection and by tests; the UI never reads the values below directly.
// Scores in the final scene are literal data (the client never computes them).

/** Example values of the mock "server". The real ones live in server/src/config/rules.ts. */
export const DEMO_SERVER = {
  players: { min: 2, max: 6 },
  deckSize: 54,
  gridSize: 4,
  timings: { arrangeMs: 5_000, initialPeekMs: 5_000, reactionWindowMs: 3_000, revealMs: 3_000, turnMs: 30_000 },
  /** Cards the black K shows (the server sends it as TurnView.powerTargetCount). */
  powers: { peekManyCount: 2 },
} as const;

/** Arbitrary fixed server clock for fixtures (the client derives its offset from `now`). */
export const DEMO_EPOCH = 1_760_000_000_000;

export const DEMO_NAMES = ['Gi', 'Ana', 'Beto', 'Cida', 'Duda', 'Edu'] as const;

export const SCENARIOS = [
  { id: 'arrumacao', label: 'Arrumação' },
  { id: 'espiada', label: 'Espiada inicial' },
  { id: 'minha-vez', label: 'Minha vez: comprar' },
  { id: 'comprada', label: 'Carta comprada na mão' },
  { id: 'poder-ver-minha', label: 'Poder: ver carta minha' },
  { id: 'poder-ver-inimigo', label: 'Poder: ver carta de inimigo' },
  { id: 'poder-q', label: 'Poder da Dama: trocar no escuro' },
  { id: 'poder-j', label: 'Poder do Valete: escolher alvo' },
  { id: 'poder-j-troca', label: 'Poder do Valete: trocar?' },
  { id: 'poder-k', label: 'Poder do Rei preto: escolher alvos' },
  { id: 'poder-k-troca', label: 'Poder do Rei preto: trocar?' },
  { id: 'reacao', label: 'Janela de reação aberta' },
  { id: 'vez-de-outro', label: 'Vez de outro jogador' },
  { id: 'estou-foda', label: '“Estou foda” chamado' },
  { id: 'fim', label: 'Fim de jogo' },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export const DEMO_PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;

export function isScenarioId(value: string): value is ScenarioId {
  return SCENARIOS.some((s) => s.id === value);
}

export interface ScenarioOptions {
  /** 2 to 6 (clamped). */
  readonly players: number;
  /** Server clock for this view. */
  readonly now?: number;
  /** Seat names, starting with yours. */
  readonly names?: readonly string[];
  /** Multiplies every demo duration (handy for slow manual tests). */
  readonly timeScale?: number;
}

// --- tiny card helpers ---------------------------------------------------------

const card = (rank: Rank, suit: Suit): Card => ({ kind: 'standard', rank, suit });
const joker = (color: 'red' | 'black'): Card => ({ kind: 'joker', color });
const H: SlotView = { state: 'hidden' };
const E: SlotView = { state: 'empty' };
const V = (c: Card, until: number | null): SlotView => ({ state: 'visible', card: c, until });

interface Ctx {
  readonly n: number;
  readonly now: number;
  readonly ids: readonly PlayerId[];
  readonly names: readonly string[];
  readonly ms: (key: keyof typeof DEMO_SERVER.timings) => number;
  /** k-th opponent (1-based), reusing the last one when the table is small. */
  readonly opp: (k: number) => PlayerId;
}

function context(options: ScenarioOptions): Ctx {
  const n = Math.min(DEMO_SERVER.players.max, Math.max(DEMO_SERVER.players.min, Math.round(options.players)));
  const ids = Array.from({ length: n }, (_, i) => `s${i}`);
  const names = Array.from({ length: n }, (_, i) => options.names?.[i] ?? DEMO_NAMES[i] ?? `Jogador ${i + 1}`);
  const scale = options.timeScale && options.timeScale > 0 ? options.timeScale : 1;
  return {
    n,
    now: options.now ?? DEMO_EPOCH,
    ids,
    names,
    ms: (key) => Math.round(DEMO_SERVER.timings[key] * scale),
    opp: (k) => ids[Math.min(k, n - 1)] ?? ids[1] ?? 's1',
  };
}

type Grids = Partial<Record<PlayerId, readonly SlotView[]>>;

function players(ctx: Ctx, grids: Grids = {}): PlayerView[] {
  return ctx.ids.map((id, i) => {
    const slots = grids[id] ?? Array.from({ length: DEMO_SERVER.gridSize }, () => H);
    return {
      id,
      name: ctx.names[i] ?? id,
      isYou: i === 0,
      cardCount: slots.filter((s) => s.state !== 'empty').length,
      slots,
    };
  });
}

function turn(playerId: PlayerId, number: number, patch: Partial<TurnView> = {}): TurnView {
  return {
    playerId,
    number,
    step: 'draw',
    hasDrawnCard: false,
    drawnCard: null,
    pendingPower: null,
    powerTargetCount: null,
    peeked: [],
    ...patch,
  };
}

/** What the server would publish as TurnView.powerTargetCount for a pending power. */
function targetCount(power: PowerKind): number {
  return power === 'peekManyAndSwap' ? DEMO_SERVER.powers.peekManyCount : 1;
}

function base(ctx: Ctx): GameView {
  return {
    now: ctx.now,
    phase: 'playing',
    phaseDeadline: null,
    you: ctx.ids[0] ?? null,
    players: players(ctx),
    turn: null,
    reactionWindow: null,
    discardTop: null,
    discardCount: 0,
    drawPileCount: DEMO_SERVER.deckSize - ctx.n * DEMO_SERVER.gridSize,
    endCall: null,
    result: null,
  };
}

function midGame(ctx: Ctx, turnsPlayed: number, discardTop: Card): GameView {
  const b = base(ctx);
  return { ...b, discardTop, discardCount: turnsPlayed, drawPileCount: b.drawPileCount - turnsPlayed };
}

function powerScene(ctx: Ctx, power: PowerKind, discarded: Card): GameView {
  return {
    ...midGame(ctx, 6, discarded),
    turn: turn(ctx.ids[0] ?? 's0', 6, { step: 'power', pendingPower: power, powerTargetCount: targetCount(power) }),
  };
}

function peekSwapScene(ctx: Ctx, power: PowerKind, discarded: Card, peeked: readonly [SlotRef, Card][]): GameView {
  const until = ctx.now + ctx.ms('revealMs');
  const grids: Record<PlayerId, SlotView[]> = {};
  for (const [ref, face] of peeked) {
    const slots = grids[ref.playerId] ?? [H, H, H, H];
    slots[ref.slot] = V(face, until);
    grids[ref.playerId] = slots;
  }
  return {
    ...midGame(ctx, 6, discarded),
    players: players(ctx, grids),
    turn: turn(ctx.ids[0] ?? 's0', 6, {
      step: 'powerSwap',
      pendingPower: power,
      powerTargetCount: targetCount(power),
      peeked: peeked.map(([ref]) => ref),
    }),
  };
}

// Final grids and totals, seat by seat (literal data of the mock server).
const END_GRIDS: readonly (readonly SlotView[])[] = [
  [V(card('A', 'spades'), null), V(card('2', 'hearts'), null), V(card('K', 'diamonds'), null), V(card('5', 'clubs'), null)],
  [V(card('3', 'diamonds'), null), V(card('9', 'clubs'), null), E, V(card('K', 'hearts'), null)],
  [V(joker('red'), null), V(card('4', 'spades'), null), V(card('3', 'clubs'), null), E],
  [V(card('K', 'spades'), null), V(card('Q', 'diamonds'), null), V(card('8', 'hearts'), null), V(card('10', 'clubs'), null)],
  [V(card('A', 'hearts'), null), V(joker('black'), null), V(card('2', 'clubs'), null), E],
  [V(card('6', 'spades'), null), V(card('7', 'hearts'), null), V(card('J', 'diamonds'), null), V(card('4', 'diamonds'), null)],
];
const END_TOTALS = [7, 11, 7, 43, 3, 28] as const;
/** Seat indexes of the winners for each table size (literal, not computed). */
const END_WINNERS: Record<number, readonly number[]> = { 2: [0], 3: [0, 2], 4: [0, 2], 5: [4], 6: [4] };

const SCENES: Record<ScenarioId, (ctx: Ctx) => GameView> = {
  arrumacao: (ctx) => ({ ...base(ctx), phase: 'arrange', phaseDeadline: ctx.now + ctx.ms('arrangeMs') }),

  espiada: (ctx) => {
    const deadline = ctx.now + ctx.ms('initialPeekMs');
    const me = ctx.ids[0] ?? 's0';
    return {
      ...base(ctx),
      phase: 'initialPeek',
      phaseDeadline: deadline,
      players: players(ctx, { [me]: [H, H, V(card('4', 'clubs'), deadline), V(card('K', 'hearts'), deadline)] }),
    };
  },

  'minha-vez': (ctx) => ({ ...base(ctx), turn: turn(ctx.ids[0] ?? 's0', 1) }),

  comprada: (ctx) => ({
    ...midGame(ctx, 4, card('6', 'diamonds')),
    turn: turn(ctx.ids[0] ?? 's0', 5, { step: 'decide', hasDrawnCard: true, drawnCard: card('K', 'spades') }),
  }),

  'poder-ver-minha': (ctx) => powerScene(ctx, 'peekOwn', card('7', 'diamonds')),
  'poder-ver-inimigo': (ctx) => powerScene(ctx, 'peekOpponent', card('9', 'clubs')),
  'poder-q': (ctx) => powerScene(ctx, 'blindSwap', card('Q', 'hearts')),
  'poder-j': (ctx) => powerScene(ctx, 'peekAndSwap', card('J', 'clubs')),
  'poder-j-troca': (ctx) =>
    peekSwapScene(ctx, 'peekAndSwap', card('J', 'clubs'), [[{ playerId: ctx.opp(1), slot: 1 }, card('2', 'diamonds')]]),
  'poder-k': (ctx) => powerScene(ctx, 'peekManyAndSwap', card('K', 'clubs')),
  'poder-k-troca': (ctx) =>
    peekSwapScene(ctx, 'peekManyAndSwap', card('K', 'clubs'), [
      [{ playerId: ctx.opp(1), slot: 0 }, card('Q', 'spades')],
      [{ playerId: ctx.opp(2), slot: 3 }, card('A', 'diamonds')],
    ]),

  reacao: (ctx) => {
    const discarder = ctx.opp(1);
    const wrong = ctx.n >= 3 ? ctx.opp(2) : null;
    const grids: Grids = wrong ? { [wrong]: [V(card('8', 'spades'), ctx.now + ctx.ms('revealMs')), H, H, H] } : {};
    return {
      ...midGame(ctx, 7, card('5', 'hearts')),
      players: players(ctx, grids),
      turn: turn(discarder, 7, { step: 'reaction' }),
      reactionWindow: {
        card: card('5', 'hearts'),
        openedBy: discarder,
        deadline: ctx.now + ctx.ms('reactionWindowMs'),
        attemptedBy: wrong ? [wrong] : [],
      },
    };
  },

  'vez-de-outro': (ctx) => ({
    ...midGame(ctx, 8, card('2', 'spades')),
    turn: turn(ctx.opp(1), 8, { step: 'decide', hasDrawnCard: true }),
  }),

  'estou-foda': (ctx) => {
    const me = ctx.ids[0] ?? 's0';
    const caller = ctx.opp(1);
    const after = ctx.ids.slice(2);
    const current = after[0] ?? me;
    return {
      ...midGame(ctx, 12, card('10', 'hearts')),
      players: players(ctx, { [me]: [H, E, H, H], [caller]: [H, H, H, E] }),
      turn: turn(current, 13),
      endCall: { callerId: caller, reason: 'called', pending: [...after, me] },
    };
  },

  fim: (ctx) => {
    const grids: Grids = {};
    ctx.ids.forEach((id, i) => {
      grids[id] = END_GRIDS[i] ?? [];
    });
    const result: GameResult = {
      reason: 'endCalled',
      scores: ctx.ids.map((playerId, i) => ({ playerId, total: END_TOTALS[i] ?? 0 })),
      winners: (END_WINNERS[ctx.n] ?? []).map((i) => ctx.ids[i] ?? ''),
    };
    return {
      ...midGame(ctx, 15, card('9', 'diamonds')),
      phase: 'ended',
      players: players(ctx, grids),
      endCall: { callerId: ctx.opp(1), reason: 'called', pending: [] },
      result,
    };
  },
};

export function buildScenario(id: ScenarioId, options: ScenarioOptions): GameView {
  return SCENES[id](context(options));
}

/**
 * The GameUpdate.turnDeadline the server would send with a scene: while the
 * current player has a decision to make (not during a reaction window), each
 * decision gets turnMs.
 */
export function scenarioTurnDeadline(view: GameView, options: Pick<ScenarioOptions, 'timeScale'> = {}): number | null {
  if (view.phase !== 'playing' || view.turn === null || view.reactionWindow !== null || view.turn.step === 'reaction') return null;
  const scale = options.timeScale && options.timeScale > 0 ? options.timeScale : 1;
  return view.now + Math.round(DEMO_SERVER.timings.turnMs * scale);
}

/**
 * Where the mock goes after an action or when a deadline passes, so the demo
 * feels alive. This is only a script for the demo, not game logic.
 */
export const DEMO_SCRIPT: Partial<
  Record<ScenarioId, { readonly onAction?: Partial<Record<string, ScenarioId>>; readonly onDeadline?: ScenarioId }>
> = {
  arrumacao: { onDeadline: 'espiada' },
  espiada: { onDeadline: 'minha-vez' },
  'minha-vez': { onAction: { draw: 'comprada', callEnd: 'estou-foda' } },
  comprada: { onAction: { discardDrawn: 'poder-k', swapWithDrawn: 'vez-de-outro', callEnd: 'estou-foda' } },
  'poder-ver-minha': { onAction: { usePower: 'vez-de-outro', skipPower: 'vez-de-outro' } },
  'poder-ver-inimigo': { onAction: { usePower: 'vez-de-outro', skipPower: 'vez-de-outro' } },
  'poder-q': { onAction: { usePower: 'vez-de-outro', skipPower: 'vez-de-outro' } },
  'poder-j': { onAction: { usePower: 'poder-j-troca', skipPower: 'vez-de-outro' } },
  'poder-j-troca': { onAction: { powerSwap: 'vez-de-outro', skipPower: 'vez-de-outro' } },
  'poder-k': { onAction: { usePower: 'poder-k-troca', skipPower: 'vez-de-outro' } },
  'poder-k-troca': { onAction: { powerSwap: 'vez-de-outro', skipPower: 'vez-de-outro' } },
  reacao: { onAction: { matchOwn: 'vez-de-outro', matchOpponent: 'vez-de-outro' }, onDeadline: 'vez-de-outro' },
};
