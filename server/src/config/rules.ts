import { z } from 'zod';
import { CARD_COLORS, POWER_KINDS, PROTOCOL_LIMITS, RANKS } from '@moises/shared';

// Every number of the game rules lives here (see docs/REGRAS.md). The engine
// reads them from the RulesConfig stored in each game state, never from
// literals. Items marked [SUPOSIÇÃO] in REGRAS.md, and the defaults chosen for
// ambiguous points, are configurable here.

const RankSchema = z.enum(RANKS);
const PowerSchema = z.enum(POWER_KINDS);
const DurationMsSchema = z.number().int().min(1).max(10 * 60_000);

const CardOverrideSchema = z.strictObject({
  value: z.number().int().optional(),
  power: PowerSchema.nullable().optional(),
});

export const RulesConfigSchema = z
  .strictObject({
    players: z.strictObject({
      min: z.number().int().min(2),
      max: z.number().int().min(2),
    }),
    deck: z.strictObject({
      /** One joker per listed color (default: one red, one black). */
      jokerColors: z.array(z.enum(CARD_COLORS)).max(2),
    }),
    cards: z.strictObject({
      /** Base value of each rank. */
      values: z.record(RankSchema, z.number().int()),
      /** Power granted by a rank when the card is drawn and discarded. Ranks not listed have none. */
      powers: z.partialRecord(RankSchema, PowerSchema),
      /** Overrides for red cards of a rank (red K = -1 and no power). */
      redOverrides: z.partialRecord(RankSchema, CardOverrideSchema),
      joker: z.strictObject({
        value: z.number().int(),
        power: PowerSchema.nullable(),
      }),
    }),
    grid: z.strictObject({
      /** Cards dealt to each player. */
      initialSize: z.number().int().min(1).max(16),
      /** Positions each player sees during the initial peek ("last column"). */
      initialPeekSlots: z.array(z.number().int().min(0)).max(16),
      // Grids never grow: a wrong reaction has no penalty card, so the grid
      // keeps its initial size (positions can become empty).
    }),
    powers: z.strictObject({
      /** How many opponent cards peekManyAndSwap (black K) shows. */
      peekManyCount: z.number().int().min(1).max(PROTOCOL_LIMITS.maxPowerTargets),
    }),
    reactions: z.strictObject({
      /** Reaction attempts each player may make per window. */
      attemptsPerWindow: z.number().int().min(1).max(10),
      /** Whether the two jokers count as "the same number". */
      jokersMatchEachOther: z.boolean(),
    }),
    timings: z.strictObject({
      arrangeMs: DurationMsSchema,
      initialPeekMs: DurationMsSchema,
      reactionWindowMs: DurationMsSchema,
      /** How long a seen card stays face up: power peeks, and the card revealed to all after a wrong reaction. */
      revealMs: DurationMsSchema,
    }),
  })
  .superRefine((rules, ctx) => {
    const deckSize = 4 * RANKS.length + rules.deck.jokerColors.length;
    if (new Set(rules.deck.jokerColors).size !== rules.deck.jokerColors.length) {
      ctx.addIssue({ code: 'custom', path: ['deck', 'jokerColors'], message: 'joker colors must be unique' });
    }
    if (rules.players.max < rules.players.min) {
      ctx.addIssue({ code: 'custom', path: ['players', 'max'], message: 'max players must be >= min players' });
    }
    if (rules.players.max * rules.grid.initialSize >= deckSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['players', 'max'],
        message: `max players x initial grid size must leave at least one card in the ${deckSize}-card deck`,
      });
    }
    if (rules.grid.initialSize - 1 > PROTOCOL_LIMITS.maxSlotIndex) {
      ctx.addIssue({ code: 'custom', path: ['grid', 'initialSize'], message: 'grid larger than the protocol allows' });
    }
    const peek = rules.grid.initialPeekSlots;
    if (new Set(peek).size !== peek.length || peek.some((slot) => slot >= rules.grid.initialSize)) {
      ctx.addIssue({
        code: 'custom',
        path: ['grid', 'initialPeekSlots'],
        message: 'initial peek slots must be unique and inside the initial grid',
      });
    }
  });

export type RulesConfig = z.infer<typeof RulesConfigSchema>;

export const DEFAULT_RULES: RulesConfig = deepFreeze({
  players: { min: 2, max: 6 }, // [SUPOSIÇÃO] 2 a 6
  deck: { jokerColors: ['red', 'black'] }, // 52 + 2 = 54 cards
  cards: {
    values: {
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
      K: 13, // black K (spades, clubs)
    },
    powers: {
      '7': 'peekOwn',
      '8': 'peekOwn',
      '9': 'peekOpponent',
      '10': 'peekOpponent',
      J: 'peekAndSwap',
      Q: 'blindSwap', // trocar no escuro (confirmed by the game owner)
      K: 'peekManyAndSwap', // black K
    },
    redOverrides: {
      K: { value: -1, power: null }, // red K (hearts, diamonds): -1 and no power (confirmed)
    },
    joker: { value: 0, power: null },
  },
  grid: {
    initialSize: 4, // 2x2: [0][1] / [2][3]
    initialPeekSlots: [2, 3], // the bottom row (the owner calls it "última coluna")
  },
  powers: {
    peekManyCount: 2, // black K sees two opponent cards
  },
  reactions: {
    attemptsPerWindow: 1, // default chosen for this release (not in REGRAS.md)
    jokersMatchEachOther: true, // default chosen for this release (not in REGRAS.md)
  },
  timings: {
    arrangeMs: 5_000,
    initialPeekMs: 5_000,
    reactionWindowMs: 3_000, // [SUPOSIÇÃO] 3 s
    revealMs: 3_000, // "um tempo curto" / "alguns segundos" — default chosen for this release
  },
});

// --- environment overrides (timings only) -------------------------------------

/** Bounds for timing overrides coming from the environment. */
export const ENV_TIMING_LIMITS = { minMs: 250, maxMs: 60_000 } as const;

export const TIMING_ENV_VARS = {
  arrangeMs: 'MOISES_ARRANGE_MS',
  initialPeekMs: 'MOISES_INITIAL_PEEK_MS',
  reactionWindowMs: 'MOISES_REACTION_WINDOW_MS',
  revealMs: 'MOISES_REVEAL_MS',
} as const satisfies Record<keyof RulesConfig['timings'], string>;

const EnvMsSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'must be a whole number of milliseconds')
  .transform(Number)
  .pipe(z.number().int().min(ENV_TIMING_LIMITS.minMs).max(ENV_TIMING_LIMITS.maxMs));

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Rules for this server process: DEFAULT_RULES with optional timing overrides
 * from the environment. Throws (fail fast at startup) on any invalid value.
 */
export function loadRules(env: Env = process.env): RulesConfig {
  const timings: Record<string, number> = { ...DEFAULT_RULES.timings };
  const problems: string[] = [];
  for (const [key, envName] of Object.entries(TIMING_ENV_VARS)) {
    const raw = env[envName];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = EnvMsSchema.safeParse(raw);
    if (parsed.success) {
      timings[key] = parsed.data;
    } else {
      problems.push(
        `${envName}=${JSON.stringify(raw)}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid rule timing in environment (allowed ${ENV_TIMING_LIMITS.minMs}-${ENV_TIMING_LIMITS.maxMs} ms): ${problems.join(', ')}`,
    );
  }
  return parseRules({ ...DEFAULT_RULES, timings });
}

/** Validates a full rules object (never trust a config you did not build). Throws on error. */
export function parseRules(input: unknown): RulesConfig {
  const parsed = RulesConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid rules config: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return deepFreeze(parsed.data);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
