import type { Card, ErrorCode, GameError, GameOverReason, GameResult, PlayerId, PowerKind } from '@moises/shared';
import { cardValue, publicCard, sameCard } from './cards.js';
import { shuffle } from './rng.js';
import type { Draft, GameState, PlayerState, Slot } from './types.js';

// Helpers that mutate a Draft (a private working copy). Never call them on a
// state that was handed to the engine by its caller.

export function gameError(code: ErrorCode, message: string): GameError {
  return { code, message };
}

export function isValidTime(now: unknown): now is number {
  return typeof now === 'number' && Number.isFinite(now) && now >= 0;
}

export function findPlayer(s: GameState, playerId: PlayerId): PlayerState | undefined {
  return s.players.find((player) => player.id === playerId);
}

export function getPlayer(s: GameState, playerId: PlayerId): PlayerState {
  const player = findPlayer(s, playerId);
  if (!player) throw new Error(`engine invariant: unknown player ${playerId}`);
  return player;
}

export function countCards(grid: readonly Slot[]): number {
  return grid.reduce((total, slot) => (slot ? total + 1 : total), 0);
}

export function opponentCardCount(s: GameState, playerId: PlayerId): number {
  return s.players.reduce((total, p) => (p.id === playerId ? total : total + countCards(p.grid)), 0);
}

export function scoreGrid(grid: readonly Slot[], rules: GameState['rules']): number {
  return grid.reduce((total, slot) => (slot ? total + cardValue(slot, rules) : total), 0);
}

export function computeResult(s: GameState, reason: GameOverReason): GameResult {
  const scores = s.players.map((p) => ({ playerId: p.id, total: scoreGrid(p.grid, s.rules) }));
  const best = Math.min(...scores.map((score) => score.total));
  return {
    reason,
    scores,
    winners: scores.filter((score) => score.total === best).map((score) => score.playerId),
  };
}

/** Whether `power` has at least one legal use for `playerId` right now. */
export function powerIsUsable(s: GameState, power: PowerKind, playerId: PlayerId): boolean {
  const own = countCards(getPlayer(s, playerId).grid);
  const opponents = opponentCardCount(s, playerId);
  switch (power) {
    case 'peekOwn':
      return own > 0;
    case 'peekOpponent':
    case 'peekAndSwap':
    case 'peekManyAndSwap':
      return opponents > 0;
    case 'blindSwap':
      return own > 0 && opponents > 0;
  }
}

/**
 * How many targets `usePower` must name for `power` right now. Single source of
 * truth: `applyAction` checks the action against it (WRONG_TARGET_COUNT) and
 * `viewFor` publishes it as `TurnView.powerTargetCount`.
 * peekManyAndSwap asks for `peekManyCount` opponent cards, limited to what is
 * on the table; every other power takes exactly one pick.
 */
export function powerTargetCount(s: GameState, power: PowerKind, playerId: PlayerId): number {
  switch (power) {
    case 'peekManyAndSwap':
      return Math.min(s.rules.powers.peekManyCount, opponentCardCount(s, playerId));
    case 'peekOwn':
    case 'peekOpponent':
    case 'blindSwap':
    case 'peekAndSwap':
      return 1;
  }
}

// --- piles -------------------------------------------------------------------

/**
 * Takes the top card of the draw pile. When it is empty, the discard pile
 * (except its top card) is shuffled into a new draw pile first.
 * Returns null only when no card is left anywhere.
 */
export function drawFromPile(d: Draft): Card | null {
  const s = d.s;
  if (s.drawPile.length === 0 && s.discardPile.length > 1) {
    const top = s.discardPile[s.discardPile.length - 1] as Card;
    const [shuffled, rng] = shuffle(s.discardPile.slice(0, -1), s.rng);
    s.rng = rng;
    s.drawPile = shuffled;
    s.discardPile = [top];
    d.events.push({ type: 'deckReshuffled', drawPileCount: s.drawPile.length });
  }
  return s.drawPile.shift() ?? null;
}

/** Puts a card face up on the discard pile. Reveals of that card end: it is public now. */
export function discard(d: Draft, card: Card): void {
  d.s.discardPile.push(card);
  d.s.reveals = d.s.reveals.filter((reveal) => !sameCard(reveal.card, card));
}

export function addReveal(d: Draft, card: Card, viewers: 'all' | readonly PlayerId[]): void {
  d.s.reveals.push({
    card: publicCard(card),
    viewers: viewers === 'all' ? 'all' : [...viewers],
    expiresAt: d.now + d.s.rules.timings.revealMs,
  });
}

// --- turn flow -----------------------------------------------------------------

export function startTurn(d: Draft, playerId: PlayerId): void {
  const s = d.s;
  s.turnCount += 1;
  s.turn = { playerId, number: s.turnCount, step: 'draw', drawnCard: null, pendingPower: null, peeked: [] };
  d.events.push({ type: 'turnStarted', playerId, turnNumber: s.turnCount });
}

export function openReactionWindow(d: Draft, card: Card, openedBy: PlayerId): void {
  const s = d.s;
  const deadline = d.now + s.rules.timings.reactionWindowMs;
  s.reaction = { card: publicCard(card), openedBy, deadline, attempts: [] };
  if (s.turn) s.turn.step = 'reaction';
  d.events.push({ type: 'reactionWindowOpened', card: publicCard(card), openedBy, deadline });
}

/** Closes the window and continues the turn: power step if there is a usable power, otherwise next turn. */
export function closeReactionWindow(d: Draft, reason: 'timeout' | 'matched'): void {
  const s = d.s;
  s.reaction = null;
  d.events.push({ type: 'reactionWindowClosed', reason });
  const turn = s.turn;
  if (s.phase !== 'playing' || !turn) return;
  const power = turn.pendingPower;
  if (power) {
    if (powerIsUsable(s, power, turn.playerId)) {
      turn.step = 'power';
      d.events.push({ type: 'powerAvailable', playerId: turn.playerId, power });
      return;
    }
    turn.pendingPower = null;
    d.events.push({ type: 'powerSkipped', playerId: turn.playerId, power, reason: 'unusable' });
  }
  endTurn(d);
}

/** Ends the current turn: final-round bookkeeping, then the next player (or the end of the game). */
export function endTurn(d: Draft): void {
  const s = d.s;
  const turn = s.turn;
  if (!turn) throw new Error('engine invariant: endTurn without a turn');
  s.turn = null;
  if (s.endCall) {
    s.endCall.pending = s.endCall.pending.filter((id) => id !== turn.playerId);
    if (s.endCall.pending.length === 0) {
      finishGame(d, 'endCalled');
      return;
    }
  }
  startTurn(d, nextPlayerId(s, turn.playerId));
}

function nextPlayerId(s: GameState, fromId: PlayerId): PlayerId {
  const count = s.players.length;
  const start = s.players.findIndex((p) => p.id === fromId);
  for (let step = 1; step <= count; step++) {
    const candidate = s.players[(start + step) % count] as PlayerState;
    if (!s.endCall || s.endCall.pending.includes(candidate.id)) return candidate.id;
  }
  throw new Error('engine invariant: no next player');
}

/** Players other than `playerId`, in seat order starting after them. */
export function othersAfter(s: GameState, playerId: PlayerId): PlayerId[] {
  const start = s.players.findIndex((p) => p.id === playerId);
  const ids: PlayerId[] = [];
  for (let step = 1; step < s.players.length; step++) {
    ids.push((s.players[(start + step) % s.players.length] as PlayerState).id);
  }
  return ids;
}

/** A player with no cards left triggers the end as if they had said "Estou foda". */
export function triggerEndIfOutOfCards(d: Draft, playerId: PlayerId): void {
  const s = d.s;
  if (s.endCall || s.phase !== 'playing') return;
  if (countCards(getPlayer(s, playerId).grid) > 0) return;
  s.endCall = { callerId: playerId, reason: 'noCards', pending: othersAfter(s, playerId) };
  d.events.push({ type: 'endCalled', playerId, reason: 'noCards' });
}

export function finishGame(d: Draft, reason: GameOverReason): void {
  const s = d.s;
  s.phase = 'ended';
  s.phaseDeadline = null;
  s.turn = null;
  s.reaction = null;
  s.reveals = [];
  s.result = computeResult(s, reason);
  d.events.push({ type: 'phaseChanged', phase: 'ended', deadline: null });
  d.events.push({ type: 'gameEnded', result: structuredClone(s.result) });
}


// --- time --------------------------------------------------------------------

/** Advances every phase whose deadline has passed, and drops expired reveals. */
export function tickDraft(d: Draft): void {
  const s = d.s;
  // Each pass handles one expired deadline; a new deadline is always in the future, so this ends.
  for (;;) {
    if (s.phase === 'arrange' && s.phaseDeadline !== null && d.now >= s.phaseDeadline) {
      s.phase = 'initialPeek';
      s.phaseDeadline = d.now + s.rules.timings.initialPeekMs;
      d.events.push({ type: 'phaseChanged', phase: 'initialPeek', deadline: s.phaseDeadline });
      continue;
    }
    if (s.phase === 'initialPeek' && s.phaseDeadline !== null && d.now >= s.phaseDeadline) {
      s.phase = 'playing';
      s.phaseDeadline = null;
      d.events.push({ type: 'phaseChanged', phase: 'playing', deadline: null });
      startTurn(d, s.firstPlayerId);
      continue;
    }
    if (s.phase === 'playing' && s.reaction && d.now >= s.reaction.deadline) {
      closeReactionWindow(d, 'timeout');
      continue;
    }
    break;
  }
  if (s.reveals.some((reveal) => reveal.expiresAt <= d.now)) {
    s.reveals = s.reveals.filter((reveal) => reveal.expiresAt > d.now);
  }
}
