import { z } from 'zod';
import { PLAYER_ID_PATTERN, PROTOCOL_LIMITS } from './limits.js';
import { REACTION_KINDS } from './game.js';
import type { PowerKind } from './powers.js';

// Everything a client may send. Actions never carry card values: only slot
// indexes and player ids. The server works out the cards itself.
// Every object is strict, so unknown keys (e.g. a forged `card`) are rejected.

export const PlayerIdSchema = z
  .string()
  .min(PROTOCOL_LIMITS.playerIdMinLength)
  .max(PROTOCOL_LIMITS.playerIdMaxLength)
  .regex(PLAYER_ID_PATTERN);

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(PROTOCOL_LIMITS.playerNameMinLength)
  .max(PROTOCOL_LIMITS.playerNameMaxLength);

export const SlotIndexSchema = z.number().int().min(0).max(PROTOCOL_LIMITS.maxSlotIndex);

export const SlotRefSchema = z.strictObject({
  playerId: PlayerIdSchema,
  slot: SlotIndexSchema,
});
export type SlotRef = z.infer<typeof SlotRefSchema>;

// --- setup -----------------------------------------------------------------

/** During the arrangement phase: swap two positions of your own grid. */
export const ArrangeActionSchema = z.strictObject({
  type: z.literal('arrange'),
  fromSlot: SlotIndexSchema,
  toSlot: SlotIndexSchema,
});

// --- turn ------------------------------------------------------------------

export const DrawActionSchema = z.strictObject({ type: z.literal('draw') });

/** Put the drawn card into one of your slots; the old card is discarded. Never activates a power. */
export const SwapWithDrawnActionSchema = z.strictObject({
  type: z.literal('swapWithDrawn'),
  slot: SlotIndexSchema,
});

/** Discard the drawn card. If it has a power, it can be used after the reaction window. */
export const DiscardDrawnActionSchema = z.strictObject({ type: z.literal('discardDrawn') });

/** "Estou foda": the current player, at any moment of their own turn. It does not end the turn. */
export const CallEndActionSchema = z.strictObject({ type: z.literal('callEnd') });

// --- powers ------------------------------------------------------------------

const UsePowerPeekOwnSchema = z.strictObject({
  type: z.literal('usePower'),
  power: z.literal('peekOwn'),
  slot: SlotIndexSchema,
});

const UsePowerPeekOpponentSchema = z.strictObject({
  type: z.literal('usePower'),
  power: z.literal('peekOpponent'),
  target: SlotRefSchema,
});

const UsePowerBlindSwapSchema = z.strictObject({
  type: z.literal('usePower'),
  power: z.literal('blindSwap'),
  ownSlot: SlotIndexSchema,
  target: SlotRefSchema,
});

const UsePowerPeekAndSwapSchema = z.strictObject({
  type: z.literal('usePower'),
  power: z.literal('peekAndSwap'),
  target: SlotRefSchema,
});

const UsePowerPeekManyAndSwapSchema = z.strictObject({
  type: z.literal('usePower'),
  power: z.literal('peekManyAndSwap'),
  targets: z.array(SlotRefSchema).min(1).max(PROTOCOL_LIMITS.maxPowerTargets),
});

export const UsePowerActionSchema = z.discriminatedUnion('power', [
  UsePowerPeekOwnSchema,
  UsePowerPeekOpponentSchema,
  UsePowerBlindSwapSchema,
  UsePowerPeekAndSwapSchema,
  UsePowerPeekManyAndSwapSchema,
]);

/** Second step of peekAndSwap / peekManyAndSwap: swap one of the peeked cards with one of yours. */
export const PowerSwapActionSchema = z.strictObject({
  type: z.literal('powerSwap'),
  ownSlot: SlotIndexSchema,
  target: SlotRefSchema,
});

/** Decline the power (or, after peeking, decline the swap). */
export const SkipPowerActionSchema = z.strictObject({ type: z.literal('skipPower') });

// --- reactions (any player, during the reaction window) ----------------------

/** "Filha da putinha": your card at `slot` has the same rank as the discarded card. */
export const MatchOwnActionSchema = z.strictObject({
  type: z.literal('matchOwn'),
  slot: SlotIndexSchema,
});

/** "Filho da puta": the opponent card at `target` has the same rank; you give your `giveSlot` card in its place. */
export const MatchOpponentActionSchema = z.strictObject({
  type: z.literal('matchOpponent'),
  target: SlotRefSchema,
  giveSlot: SlotIndexSchema,
});

/**
 * Claims the reaction window for yourself ("Filho da puta!" shout): the first valid
 * claim locks the window for that player and extends its deadline, so they have time
 * to pick the cards. Only the claimant may then send the matching `kind`.
 */
export const ClaimReactionActionSchema = z.strictObject({
  type: z.literal('claimReaction'),
  kind: z.enum(REACTION_KINDS),
});

export const ActionSchema = z.discriminatedUnion('type', [
  ArrangeActionSchema,
  DrawActionSchema,
  SwapWithDrawnActionSchema,
  DiscardDrawnActionSchema,
  CallEndActionSchema,
  UsePowerActionSchema,
  PowerSwapActionSchema,
  SkipPowerActionSchema,
  MatchOwnActionSchema,
  MatchOpponentActionSchema,
  ClaimReactionActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
export type UsePowerAction = z.infer<typeof UsePowerActionSchema>;
// Compile-time guard: the usePower variants must cover exactly POWER_KINDS.
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const powerSchemaCoversAllKinds: Exactly<UsePowerAction['power'], PowerKind> = true;
void powerSchemaCoversAllKinds;

export type ReactionAction = z.infer<typeof MatchOwnActionSchema> | z.infer<typeof MatchOpponentActionSchema>;

export type ParseActionResult =
  | { readonly ok: true; readonly action: Action }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Validates an untrusted payload. Never throws. */
export function parseAction(input: unknown): ParseActionResult {
  const result = ActionSchema.safeParse(input);
  if (result.success) return { ok: true, action: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}
