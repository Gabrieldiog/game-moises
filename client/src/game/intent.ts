import { PROTOCOL_LIMITS, type Action, type PlayerView, type PowerKind, type ReactionKind, type SlotRef } from '@moises/shared';
import { sameRef, type UiContext } from './selectors';

// Card selection ("tap a card to choose a position / a target") and the typed
// actions it turns into. Only the *shape* of the action is built here; whether
// the move is legal and what it does is decided by the server.

export interface Picks {
  /** Your own positions, in the order they were tapped. */
  readonly own: readonly number[];
  /** Opponent positions, in the order they were tapped. */
  readonly opponents: readonly SlotRef[];
}

export const NO_PICKS: Picks = { own: [], opponents: [] };

export type Shout = ReactionKind;

export interface PickPolicy {
  /** How many of your own cards can be selected (0 = none). */
  readonly own: number;
  /** How many opponent cards can be selected (0 = none). */
  readonly opponents: number;
  /** When set, only these opponent positions can be selected. */
  readonly onlyRefs: readonly SlotRef[] | null;
}

const NONE: PickPolicy = { own: 0, opponents: 0, onlyRefs: null };

/** Opponent cards the black K must name: the server's number when the view has it. */
export function peekManyTargets(targetCount: number | null): number {
  return targetCount !== null && targetCount > 0 ? targetCount : PROTOCOL_LIMITS.maxPowerTargets;
}

const own1: PickPolicy = { own: 1, opponents: 0, onlyRefs: null };
const opp1: PickPolicy = { own: 0, opponents: 1, onlyRefs: null };

/**
 * Which cards can be tapped now. Two-card choices go in a fixed order (first
 * one side, then the other), so only the cards of the current step light up;
 * "Recomeçar" clears the choice.
 */
export function pickPolicy(ctx: UiContext, picks: Picks = NO_PICKS): PickPolicy {
  switch (ctx.kind) {
    case 'arrange':
      return { own: 2, opponents: 0, onlyRefs: null };
    case 'myDecide':
      return own1;
    case 'myPower':
      switch (ctx.power) {
        case 'peekOwn':
          return own1;
        case 'peekOpponent':
        case 'peekAndSwap':
          return opp1;
        case 'blindSwap':
          // Q: yours first, then the opponent's.
          return picks.own.length === 0 ? own1 : picks.opponents.length === 0 ? opp1 : NONE;
        case 'peekManyAndSwap':
          // How many cards the black K shows is a server rule (TurnView.powerTargetCount);
          // without it, the client only caps at the protocol limit and the server answers WRONG_TARGET_COUNT.
          return { own: 0, opponents: peekManyTargets(ctx.targetCount), onlyRefs: null };
      }
      return NONE;
    case 'myPowerSwap':
      // Several peeked cards: first which of them, then yours. One peeked card: only yours.
      if (ctx.peeked.length > 1 && picks.opponents.length === 0) return { own: 0, opponents: 1, onlyRefs: ctx.peeked };
      return picks.own.length === 0 ? own1 : NONE;
    case 'claim':
      if (ctx.reaction === 'matchOwn') return own1;
      // "Filho da puta": the opponent's card first, then the one you give.
      return picks.opponents.length === 0 ? opp1 : own1;
    default:
      return NONE;
  }
}

export function canPickOwn(policy: PickPolicy, me: PlayerView | null, slot: number): boolean {
  return policy.own > 0 && me !== null && me.slots[slot] !== undefined && me.slots[slot].state !== 'empty';
}

export function canPickOpponent(policy: PickPolicy, player: PlayerView, slot: number): boolean {
  if (policy.opponents === 0 || player.isYou) return false;
  const s = player.slots[slot];
  if (s === undefined || s.state === 'empty') return false;
  if (policy.onlyRefs === null) return true;
  return policy.onlyRefs.some((ref) => sameRef(ref, { playerId: player.id, slot }));
}

function toggle<T>(list: readonly T[], item: T, max: number, same: (a: T, b: T) => boolean): T[] {
  if (list.some((x) => same(x, item))) return list.filter((x) => !same(x, item));
  if (max <= 0) return [...list];
  if (max === 1) return [item];
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function toggleOwn(picks: Picks, slot: number, policy: PickPolicy): Picks {
  return { ...picks, own: toggle(picks.own, slot, policy.own, (a, b) => a === b) };
}

export function toggleOpponent(picks: Picks, ref: SlotRef, policy: PickPolicy): Picks {
  return { ...picks, opponents: toggle(picks.opponents, ref, policy.opponents, sameRef) };
}

// --- picks -> typed actions ---------------------------------------------------

export function arrangeAction(picks: Picks): Action | null {
  const [fromSlot, toSlot] = picks.own;
  if (fromSlot === undefined || toSlot === undefined) return null;
  return { type: 'arrange', fromSlot, toSlot };
}

export function swapWithDrawnAction(picks: Picks): Action | null {
  const slot = picks.own[0];
  return slot === undefined ? null : { type: 'swapWithDrawn', slot };
}

/**
 * The usePower action for the selected cards, or null while the selection is
 * incomplete. For the black K, `targetCount` (TurnView.powerTargetCount) says
 * how many cards the server expects; the button waits for exactly that many.
 */
export function usePowerAction(power: PowerKind, picks: Picks, targetCount: number | null = null): Action | null {
  const own = picks.own[0];
  const target = picks.opponents[0];
  switch (power) {
    case 'peekOwn':
      return own === undefined ? null : { type: 'usePower', power, slot: own };
    case 'peekOpponent':
      return target === undefined ? null : { type: 'usePower', power, target: { ...target } };
    case 'blindSwap':
      return own === undefined || target === undefined
        ? null
        : { type: 'usePower', power, ownSlot: own, target: { ...target } };
    case 'peekAndSwap':
      return target === undefined ? null : { type: 'usePower', power, target: { ...target } };
    case 'peekManyAndSwap':
      return picks.opponents.length === 0 || (targetCount !== null && targetCount > 0 && picks.opponents.length !== targetCount)
        ? null
        : { type: 'usePower', power, targets: picks.opponents.map((ref) => ({ ...ref })) };
  }
}

/** With a single peeked card there is nothing to choose on the opponent side. */
export function powerSwapTarget(picks: Picks, peeked: readonly SlotRef[]): SlotRef | null {
  const picked = picks.opponents[0];
  if (picked !== undefined) return picked;
  return peeked.length === 1 ? (peeked[0] ?? null) : null;
}

export function powerSwapAction(picks: Picks, peeked: readonly SlotRef[]): Action | null {
  const own = picks.own[0];
  const target = powerSwapTarget(picks, peeked);
  if (own === undefined || target === null) return null;
  return { type: 'powerSwap', ownSlot: own, target: { ...target } };
}

export function shoutAction(shout: Shout, picks: Picks): Action | null {
  const own = picks.own[0];
  if (shout === 'matchOwn') return own === undefined ? null : { type: 'matchOwn', slot: own };
  const target = picks.opponents[0];
  if (own === undefined || target === undefined) return null;
  return { type: 'matchOpponent', target: { ...target }, giveSlot: own };
}
