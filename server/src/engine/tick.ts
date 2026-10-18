import { isValidTime, tickDraft } from './internal.js';
import type { Draft, GameState, TickResult } from './types.js';

/**
 * Advances everything whose deadline is <= now: arrange -> initialPeek ->
 * first turn, closing the reaction window (then power step or next turn), and
 * expiring revealed cards. The engine never uses timers; the server calls
 * this when nextDeadline() is reached. Returns the same state object when
 * nothing changed. The input is never modified.
 */
export function tick(state: GameState, now: number): TickResult {
  if (!isValidTime(now)) throw new RangeError('tick: now must be a finite, non-negative number');
  const d: Draft = { s: structuredClone(state), now, events: [] };
  tickDraft(d);
  if (d.events.length === 0 && d.s.reveals.length === state.reveals.length) {
    return { state, events: [] };
  }
  return { state: d.s, events: d.events };
}

/** Earliest moment the state changes on its own (phase end, reaction window, reveal expiry); null if none. */
export function nextDeadline(state: GameState): number | null {
  const candidates: number[] = [];
  if (state.phaseDeadline !== null && (state.phase === 'arrange' || state.phase === 'initialPeek')) {
    candidates.push(state.phaseDeadline);
  }
  if (state.reaction) candidates.push(state.reaction.deadline);
  for (const reveal of state.reveals) candidates.push(reveal.expiresAt);
  return candidates.length === 0 ? null : Math.min(...candidates);
}
