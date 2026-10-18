import type { GameView, PlayerId, PlayerView, PowerKind, SlotRef, SlotView } from '@moises/shared';

// Read-only helpers over the GameView sent by the server. Nothing here decides
// a game outcome: they only answer "what should the screen show / offer now".
// The server validates every action anyway.

export function findMe(view: GameView): PlayerView | null {
  return view.players.find((p) => p.isYou) ?? null;
}

export function playerName(view: GameView, id: PlayerId): string {
  return view.players.find((p) => p.id === id)?.name ?? id;
}

/**
 * Opponents in turn order starting with the player right after you, so the
 * table reads clockwise from your seat (bottom). Spectators see everyone.
 */
export function opponentsInSeatOrder(view: GameView): PlayerView[] {
  const meIndex = view.players.findIndex((p) => p.isYou);
  if (meIndex < 0) return [...view.players];
  const after = view.players.slice(meIndex + 1);
  const before = view.players.slice(0, meIndex);
  return [...after, ...before];
}

export type SeatArea = 'left' | 'top' | 'right';

/**
 * Where each opponent sits around you, clockwise: first to your left, then
 * across the top, then to your right. Purely visual.
 */
export function seatAreas(count: number): SeatArea[] {
  if (count <= 0) return [];
  if (count <= 3) return Array.from({ length: count }, () => 'top' as const);
  const top = count - 2;
  return ['left', ...Array.from({ length: top }, () => 'top' as const), 'right'];
}

/** A card whose `until` has passed is shown face down again (the server clock decides). */
export function effectiveSlot(slot: SlotView, serverNow: number): SlotView {
  if (slot.state === 'visible' && slot.until !== null && slot.until <= serverNow) return { state: 'hidden' };
  return slot;
}

/** Whether some face-up card will turn face down by itself later (so the screen must keep ticking). */
export function hasTimedCards(view: GameView, serverNow: number): boolean {
  return view.players.some((p) =>
    p.slots.some((s) => s.state === 'visible' && s.until !== null && s.until > serverNow),
  );
}

export type CountdownKind = 'arrange' | 'initialPeek' | 'reaction' | 'turn';

export interface ActiveCountdown {
  readonly kind: CountdownKind;
  readonly deadline: number;
}

/**
 * The deadline currently shown to the player: the setup phases and the
 * reaction window come in the GameView; the time left for the current
 * player's decision is GameUpdate.turnDeadline (null while not waiting for them).
 * All of them are server clock.
 */
export function activeCountdown(view: GameView, turnDeadline: number | null = null): ActiveCountdown | null {
  if ((view.phase === 'arrange' || view.phase === 'initialPeek') && view.phaseDeadline !== null) {
    return { kind: view.phase, deadline: view.phaseDeadline };
  }
  if (view.phase === 'playing' && view.reactionWindow) {
    return { kind: 'reaction', deadline: view.reactionWindow.deadline };
  }
  if (view.phase === 'playing' && view.turn !== null && turnDeadline !== null) {
    return { kind: 'turn', deadline: turnDeadline };
  }
  return null;
}

/** What the viewer is being offered right now. */
export type UiContext =
  | { readonly kind: 'spectator' }
  | { readonly kind: 'arrange' }
  | { readonly kind: 'initialPeek' }
  | { readonly kind: 'myDraw' }
  | { readonly kind: 'myDecide' }
  /** targetCount: TurnView.powerTargetCount, how many cards the server expects (null if unknown). */
  | { readonly kind: 'myPower'; readonly power: PowerKind; readonly targetCount: number | null }
  | { readonly kind: 'myPowerSwap'; readonly peeked: readonly SlotRef[] }
  | { readonly kind: 'reaction'; readonly canReact: boolean }
  | { readonly kind: 'waiting'; readonly playerId: PlayerId | null }
  | { readonly kind: 'ended' };

export function uiContext(view: GameView, serverNow: number): UiContext {
  if (view.phase === 'ended') return { kind: 'ended' };
  if (view.you === null) return { kind: 'spectator' };
  if (view.phase === 'arrange') return { kind: 'arrange' };
  if (view.phase === 'initialPeek') return { kind: 'initialPeek' };

  const window = view.reactionWindow;
  if (window) {
    const open = window.deadline > serverNow;
    // The server says how many attempts the viewer has left (2 per window by default).
    const canReact = open && (window.yourAttemptsLeft ?? 0) > 0;
    return { kind: 'reaction', canReact };
  }

  const turn = view.turn;
  if (!turn) return { kind: 'waiting', playerId: null };
  if (turn.playerId !== view.you) return { kind: 'waiting', playerId: turn.playerId };
  switch (turn.step) {
    case 'draw':
      return { kind: 'myDraw' };
    case 'decide':
      return { kind: 'myDecide' };
    case 'power':
      return turn.pendingPower
        ? { kind: 'myPower', power: turn.pendingPower, targetCount: turn.powerTargetCount ?? null }
        : { kind: 'waiting', playerId: turn.playerId };
    case 'powerSwap':
      return { kind: 'myPowerSwap', peeked: turn.peeked };
    case 'reaction':
      // The window already closed on our clock; the server will move on.
      return { kind: 'reaction', canReact: false };
  }
}

/** "Estou foda" is offered during your own turn while nobody has called the end. The server validates it. */
export function canOfferCallEnd(view: GameView): boolean {
  return view.phase === 'playing' && view.you !== null && view.turn?.playerId === view.you && view.endCall === null;
}

/**
 * Key that changes whenever the offered interaction changes, so a pending
 * card selection never leaks from one step into the next.
 */
export function contextKey(view: GameView, ctx: UiContext): string {
  const turn = view.turn;
  const window = view.reactionWindow;
  return [
    view.phase,
    ctx.kind,
    turn ? `${turn.playerId}:${turn.number}:${turn.step}` : '-',
    window ? `${window.openedBy}:${window.deadline}` : '-',
  ].join('|');
}

export function sameRef(a: SlotRef, b: SlotRef): boolean {
  return a.playerId === b.playerId && a.slot === b.slot;
}

export function serverDeadlinePassed(deadline: number, serverNow: number): boolean {
  return deadline <= serverNow;
}
