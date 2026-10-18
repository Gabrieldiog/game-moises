import type { Card, GameView, PlayerId, PlayerView, SlotView } from '@moises/shared';
import { publicCard, sameCard } from './cards.js';
import { countCards, powerTargetCount } from './internal.js';
import { tick } from './tick.js';
import type { GameState, Slot } from './types.js';

const EMPTY: SlotView = { state: 'empty' };
const HIDDEN: SlotView = { state: 'hidden' };

/**
 * What `viewerId` may see at time `now`. Built field by field from a
 * whitelist, so nothing from the state leaks by accident. A card face is
 * included only when the viewer is entitled to it right now:
 * - the face-up discard (top card) and the reaction window card;
 * - the drawn card, only for the player who drew it;
 * - own bottom-row cards during the initial peek, only for their owner;
 * - cards revealed to this viewer (powers) or to everyone (wrong reaction), until they expire;
 * - every grid card once the game has ended.
 * Unknown viewer ids get a spectator view (public information only).
 */
export function viewFor(state: GameState, viewerId: PlayerId, now: number): GameView {
  const s = tick(state, now).state; // never show something whose time is over
  const you = s.players.some((p) => p.id === viewerId) ? viewerId : null;

  const players: PlayerView[] = s.players.map((player) => ({
    id: player.id,
    name: player.name,
    isYou: player.id === you,
    cardCount: countCards(player.grid),
    slots: player.grid.map((slot, index) => slotView(s, you, player.id, index, slot, now)),
  }));

  const turn = s.turn;
  const top = s.discardPile[s.discardPile.length - 1];

  return {
    now,
    phase: s.phase,
    phaseDeadline: s.phaseDeadline,
    you,
    players,
    turn: turn
      ? {
          playerId: turn.playerId,
          number: turn.number,
          step: turn.step,
          hasDrawnCard: turn.drawnCard !== null,
          drawnCard: turn.drawnCard && you !== null && turn.playerId === you ? publicCard(turn.drawnCard) : null,
          pendingPower: turn.pendingPower,
          powerTargetCount: turn.pendingPower ? powerTargetCount(s, turn.pendingPower, turn.playerId) : null,
          peeked: turn.peeked.map((ref) => ({ playerId: ref.playerId, slot: ref.slot })),
        }
      : null,
    reactionWindow: s.reaction
      ? {
          card: publicCard(s.reaction.card),
          openedBy: s.reaction.openedBy,
          deadline: s.reaction.deadline,
          attemptedBy: [...new Set(s.reaction.attempts)],
          attemptsPerPlayer: s.rules.reactions.attemptsPerWindow,
          yourAttemptsLeft:
            you === null
              ? null
              : Math.max(0, s.rules.reactions.attemptsPerWindow - s.reaction.attempts.filter((id) => id === you).length),
        }
      : null,
    discardTop: top ? publicCard(top) : null,
    discardCount: s.discardPile.length,
    drawPileCount: s.drawPile.length,
    endCall: s.endCall
      ? { callerId: s.endCall.callerId, reason: s.endCall.reason, pending: [...s.endCall.pending] }
      : null,
    result: s.result ? structuredClone(s.result) : null,
  };
}

function slotView(
  s: GameState,
  viewer: PlayerId | null,
  owner: PlayerId,
  index: number,
  card: Slot,
  now: number,
): SlotView {
  if (!card) return EMPTY;
  if (s.phase === 'ended') return visible(card, null);
  if (
    s.phase === 'initialPeek' &&
    viewer !== null &&
    viewer === owner &&
    s.rules.grid.initialPeekSlots.includes(index)
  ) {
    return visible(card, s.phaseDeadline);
  }
  let until: number | null = null;
  for (const reveal of s.reveals) {
    if (reveal.expiresAt <= now || !sameCard(reveal.card, card)) continue;
    const allowed = reveal.viewers === 'all' || (viewer !== null && reveal.viewers.includes(viewer));
    if (allowed && (until === null || reveal.expiresAt > until)) until = reveal.expiresAt;
  }
  return until === null ? HIDDEN : visible(card, until);
}

function visible(card: Card, until: number | null): SlotView {
  return { state: 'visible', card: publicCard(card), until };
}
