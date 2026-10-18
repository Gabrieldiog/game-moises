import {
  ActionSchema,
  type Action,
  type GameError,
  type PlayerId,
  type ReactionKind,
  type SlotRef,
  type TurnStep,
  type UsePowerAction,
} from '@moises/shared';
import { cardPower, publicCard, sameRank } from './cards.js';
import {
  addReveal,
  closeReactionWindow,
  countCards,
  discard,
  drawFromPile,
  endTurn,
  findPlayer,
  finishGame,
  gameError,
  getPlayer,
  isValidTime,
  openReactionWindow,
  othersAfter,
  powerTargetCount,
  tickDraft,
} from './internal.js';
import type { Draft, EngineResult, GameState, PlayerState, TurnState } from './types.js';

/**
 * Applies one player action. Nothing from the caller is trusted: the payload
 * is schema-validated and every rule (phase, turn, ownership, slots, powers,
 * reaction window) is checked against the state.
 *
 * Deadlines that passed before `now` are applied first (as tick would).
 * The input state is never modified; on error no state is returned.
 */
export function applyAction(state: GameState, playerId: unknown, action: unknown, now: unknown): EngineResult {
  assertState(state);
  if (!isValidTime(now)) return failure('INVALID_TIME', 'now must be a finite, non-negative number');
  if (typeof playerId !== 'string' || !findPlayer(state, playerId)) {
    return failure('UNKNOWN_PLAYER', 'player is not in this game');
  }
  const parsed = ActionSchema.safeParse(action);
  if (!parsed.success) {
    return failure('INVALID_ACTION', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  const d: Draft = { s: structuredClone(state), now, events: [] };
  tickDraft(d);
  if (d.s.phase === 'ended') return failure('GAME_OVER', 'the game is over');

  const error = dispatch(d, playerId, parsed.data);
  if (error) return { ok: false, error };
  return { ok: true, state: d.s, events: d.events };
}

function dispatch(d: Draft, me: PlayerId, action: Action): GameError | null {
  switch (action.type) {
    case 'arrange':
      return arrange(d, me, action.fromSlot, action.toSlot);
    case 'draw':
      return draw(d, me);
    case 'swapWithDrawn':
      return swapWithDrawn(d, me, action.slot);
    case 'discardDrawn':
      return discardDrawn(d, me);
    case 'callEnd':
      return callEnd(d, me);
    case 'usePower':
      return usePower(d, me, action);
    case 'powerSwap':
      return powerSwap(d, me, action.ownSlot, action.target);
    case 'skipPower':
      return skipPower(d, me);
    case 'matchOwn':
      return matchOwn(d, me, action.slot);
    case 'matchOpponent':
      return matchOpponent(d, me, action.target, action.giveSlot);
    case 'claimReaction':
      return claimReaction(d, me, action.kind);
  }
}

// --- setup -------------------------------------------------------------------

function arrange(d: Draft, me: PlayerId, fromSlot: number, toSlot: number): GameError | null {
  if (d.s.phase !== 'arrange') return gameError('INVALID_PHASE', 'cards can only be arranged during the arrangement phase');
  const player = getPlayer(d.s, me);
  if (fromSlot >= player.grid.length || toSlot >= player.grid.length) {
    return gameError('INVALID_SLOT', 'slot outside your grid');
  }
  if (fromSlot === toSlot) return gameError('SAME_SLOT', 'choose two different slots');
  const moving = player.grid[fromSlot] ?? null;
  player.grid[fromSlot] = player.grid[toSlot] ?? null;
  player.grid[toSlot] = moving;
  d.events.push({ type: 'cardsArranged', playerId: me, fromSlot, toSlot });
  return null;
}

// --- turn --------------------------------------------------------------------

function requireTurn(d: Draft, me: PlayerId, steps: readonly TurnStep[]): TurnState | GameError {
  const s = d.s;
  if (s.phase !== 'playing' || !s.turn) return gameError('INVALID_PHASE', `not allowed during ${s.phase}`);
  if (s.turn.playerId !== me) return gameError('NOT_YOUR_TURN', 'it is not your turn');
  if (!steps.includes(s.turn.step)) return gameError('INVALID_PHASE', `not allowed at turn step "${s.turn.step}"`);
  return s.turn;
}

function isError(value: TurnState | GameError): value is GameError {
  return 'code' in value;
}

function draw(d: Draft, me: PlayerId): GameError | null {
  const turn = requireTurn(d, me, ['draw']);
  if (isError(turn)) return turn;
  const card = drawFromPile(d);
  if (!card) {
    finishGame(d, 'deckExhausted');
    return null;
  }
  turn.drawnCard = card;
  turn.step = 'decide';
  d.events.push({ type: 'cardDrawn', playerId: me });
  return null;
}

function swapWithDrawn(d: Draft, me: PlayerId, slot: number): GameError | null {
  const turn = requireTurn(d, me, ['decide']);
  if (isError(turn)) return turn;
  const player = getPlayer(d.s, me);
  const slotError = checkOccupiedSlot(player, slot);
  if (slotError) return slotError;
  const drawn = turn.drawnCard;
  if (!drawn) throw new Error('engine invariant: decide step without a drawn card');
  const old = player.grid[slot];
  if (!old) throw new Error('engine invariant: occupied slot is empty');
  player.grid[slot] = drawn;
  turn.drawnCard = null;
  turn.pendingPower = null; // a swap never activates a power
  discard(d, old);
  d.events.push({ type: 'drawnCardSwapped', playerId: me, slot, discarded: publicCard(old) });
  openReactionWindow(d, old, me);
  return null;
}

function discardDrawn(d: Draft, me: PlayerId): GameError | null {
  const turn = requireTurn(d, me, ['decide']);
  if (isError(turn)) return turn;
  const drawn = turn.drawnCard;
  if (!drawn) throw new Error('engine invariant: decide step without a drawn card');
  turn.drawnCard = null;
  // Only a card that was drawn and discarded this turn grants its power.
  turn.pendingPower = cardPower(drawn, d.s.rules);
  discard(d, drawn);
  d.events.push({ type: 'drawnCardDiscarded', playerId: me, card: publicCard(drawn) });
  openReactionWindow(d, drawn, me);
  return null;
}

const ALL_TURN_STEPS: readonly TurnStep[] = ['draw', 'decide', 'reaction', 'power', 'powerSwap'];

/**
 * "Estou foda": allowed at any moment of the caller's own turn. The turn goes
 * on normally; afterwards every other player plays one more turn, and the game
 * ends when the turn would come back to the caller.
 */
function callEnd(d: Draft, me: PlayerId): GameError | null {
  const turn = requireTurn(d, me, ALL_TURN_STEPS);
  if (isError(turn)) return turn;
  if (d.s.endCall) return gameError('END_ALREADY_CALLED', 'the end of the game was already called');
  d.s.endCall = { callerId: me, reason: 'called', pending: othersAfter(d.s, me) };
  d.events.push({ type: 'endCalled', playerId: me, reason: 'called' });
  return null;
}

// --- powers --------------------------------------------------------------------

function usePower(d: Draft, me: PlayerId, action: UsePowerAction): GameError | null {
  const turn = requireTurn(d, me, ['power']);
  if (isError(turn)) return turn;
  const power = turn.pendingPower;
  if (!power) throw new Error('engine invariant: power step without a pending power');
  if (action.power !== power) {
    return gameError('POWER_MISMATCH', `the discarded card grants "${power}", not "${action.power}"`);
  }
  const s = d.s;
  const player = getPlayer(s, me);

  switch (action.power) {
    case 'peekOwn': {
      const slotError = checkOccupiedSlot(player, action.slot);
      if (slotError) return slotError;
      addReveal(d, player.grid[action.slot] as NonNullable<PlayerState['grid'][number]>, [me]);
      d.events.push({ type: 'powerUsed', by: me, power, ownSlot: action.slot, targets: [] });
      d.events.push({ type: 'cardPeeked', by: me, target: { playerId: me, slot: action.slot } });
      endTurn(d);
      return null;
    }
    case 'peekOpponent': {
      const targetError = checkOpponentTarget(s, me, action.target);
      if (targetError) return targetError;
      addReveal(d, cardAt(s, action.target), [me]);
      d.events.push({ type: 'powerUsed', by: me, power, ownSlot: null, targets: [copyRef(action.target)] });
      d.events.push({ type: 'cardPeeked', by: me, target: copyRef(action.target) });
      endTurn(d);
      return null;
    }
    case 'blindSwap': {
      const slotError = checkOccupiedSlot(player, action.ownSlot) ?? checkOpponentTarget(s, me, action.target);
      if (slotError) return slotError;
      swapCards(s, { playerId: me, slot: action.ownSlot }, action.target);
      d.events.push({
        type: 'powerUsed',
        by: me,
        power,
        ownSlot: action.ownSlot,
        targets: [copyRef(action.target)],
      });
      d.events.push({
        type: 'cardsSwapped',
        by: me,
        a: { playerId: me, slot: action.ownSlot },
        b: copyRef(action.target),
        blind: true,
      });
      endTurn(d);
      return null;
    }
    case 'peekAndSwap':
      return peekThenOfferSwap(d, me, turn, [action.target]);
    case 'peekManyAndSwap': {
      const required = powerTargetCount(s, action.power, me);
      if (action.targets.length !== required) {
        return gameError('WRONG_TARGET_COUNT', `choose exactly ${required} opponent card(s)`);
      }
      return peekThenOfferSwap(d, me, turn, action.targets);
    }
  }
}

function peekThenOfferSwap(d: Draft, me: PlayerId, turn: TurnState, targets: readonly SlotRef[]): GameError | null {
  const s = d.s;
  const seen = new Set<string>();
  for (const target of targets) {
    const targetError = checkOpponentTarget(s, me, target);
    if (targetError) return targetError;
    const key = `${target.playerId}#${target.slot}`;
    if (seen.has(key)) return gameError('DUPLICATE_TARGET', 'the same card was chosen twice');
    seen.add(key);
  }
  for (const target of targets) addReveal(d, cardAt(s, target), [me]);
  const power = turn.pendingPower as NonNullable<TurnState['pendingPower']>;
  turn.peeked = targets.map(copyRef);
  d.events.push({ type: 'powerUsed', by: me, power, ownSlot: null, targets: targets.map(copyRef) });
  for (const target of targets) d.events.push({ type: 'cardPeeked', by: me, target: copyRef(target) });
  if (countCards(getPlayer(s, me).grid) === 0) {
    endTurn(d); // nothing of yours to swap
    return null;
  }
  turn.step = 'powerSwap';
  return null;
}

function powerSwap(d: Draft, me: PlayerId, ownSlot: number, target: SlotRef): GameError | null {
  const turn = requireTurn(d, me, ['powerSwap']);
  if (isError(turn)) return turn;
  if (!turn.peeked.some((ref) => ref.playerId === target.playerId && ref.slot === target.slot)) {
    return gameError('TARGET_NOT_PEEKED', 'you can only swap with a card you just looked at');
  }
  const s = d.s;
  const slotError = checkOccupiedSlot(getPlayer(s, me), ownSlot) ?? checkOpponentTarget(s, me, target);
  if (slotError) return slotError;
  swapCards(s, { playerId: me, slot: ownSlot }, target);
  d.events.push({
    type: 'cardsSwapped',
    by: me,
    a: { playerId: me, slot: ownSlot },
    b: copyRef(target),
    blind: false,
  });
  endTurn(d);
  return null;
}

function skipPower(d: Draft, me: PlayerId): GameError | null {
  const turn = requireTurn(d, me, ['power', 'powerSwap']);
  if (isError(turn)) return turn;
  const power = turn.pendingPower as NonNullable<TurnState['pendingPower']>;
  d.events.push({ type: 'powerSkipped', by: me, power, reason: 'player' });
  endTurn(d);
  return null;
}

// --- reactions -----------------------------------------------------------------

function requireReactionWindow(d: Draft, me: PlayerId): GameError | null {
  const s = d.s;
  if (s.phase !== 'playing') return gameError('INVALID_PHASE', `reactions are not allowed during ${s.phase}`);
  // tickDraft already closed any window whose deadline is <= now.
  if (!s.reaction) return gameError('REACTION_WINDOW_CLOSED', 'there is no open reaction window');
  const used = s.reaction.attempts.filter((id) => id === me).length;
  if (used >= s.rules.reactions.attemptsPerWindow) {
    return gameError('REACTION_ALREADY_ATTEMPTED', 'you already reacted to this discard');
  }
  return null;
}

/** Only the claimant may react while the window is locked, and only with the claimed kind. */
function checkClaim(d: Draft, me: PlayerId, kind: ReactionKind): GameError | null {
  const claim = (d.s.reaction as NonNullable<GameState['reaction']>).claim;
  if (!claim) return null;
  if (claim.by !== me) return gameError('REACTION_CLAIMED', 'another player claimed this reaction');
  if (claim.kind !== kind) return gameError('INVALID_ACTION', `you claimed "${claim.kind}", not "${kind}"`);
  return null;
}

/** After a wrong reaction by the claimant: release the lock and give the table a short window again. */
function releaseClaim(d: Draft): void {
  const reaction = d.s.reaction as NonNullable<GameState['reaction']>;
  if (!reaction.claim) return;
  reaction.claim = null;
  reaction.deadline = Math.max(reaction.baseDeadline, d.now + d.s.rules.timings.reactionWindowMs);
}

function claimReaction(d: Draft, me: PlayerId, kind: ReactionKind): GameError | null {
  const windowError = requireReactionWindow(d, me);
  if (windowError) return windowError;
  if (!d.s.rules.reactions[kind]) return gameError('REACTION_DISABLED', `${kind} is switched off for this game`);
  const reaction = d.s.reaction as NonNullable<GameState['reaction']>;
  if (reaction.claim) return gameError('REACTION_CLAIMED', 'this reaction window is already claimed');
  reaction.claim = { by: me, kind };
  reaction.deadline = d.now + d.s.rules.timings.reactionClaimMs;
  d.events.push({ type: 'reactionClaimed', by: me, kind });
  return null;
}

function matchOwn(d: Draft, me: PlayerId, slot: number): GameError | null {
  const windowError = requireReactionWindow(d, me);
  if (windowError) return windowError;
  if (!d.s.rules.reactions.matchOwn) return gameError('REACTION_DISABLED', 'matchOwn is switched off for this game');
  const claimError = checkClaim(d, me, 'matchOwn');
  if (claimError) return claimError;
  const s = d.s;
  const reaction = s.reaction as NonNullable<GameState['reaction']>;
  const player = getPlayer(s, me);
  const slotError = checkOccupiedSlot(player, slot);
  if (slotError) return slotError;
  const card = player.grid[slot] as NonNullable<PlayerState['grid'][number]>;
  reaction.attempts.push(me);

  if (sameRank(card, reaction.card, s.rules)) {
    player.grid[slot] = null;
    discard(d, card);
    d.events.push({ type: 'reactionSucceeded', reaction: 'matchOwn', playerId: me, slot, card: publicCard(card) });
    d.events.push({ type: 'reactionResolved', by: me, kind: 'matchOwn', ok: true, slots: [{ playerId: me, slot }] });
    closeReactionWindow(d, 'matched'); // only the first right reaction counts
    return null;
  }
  // Wrong: nothing moves; the card you tried to discard is shown to everyone for a while.
  addReveal(d, card, 'all');
  d.events.push({ type: 'reactionFailed', reaction: 'matchOwn', playerId: me, slot, revealed: publicCard(card) });
  d.events.push({ type: 'reactionResolved', by: me, kind: 'matchOwn', ok: false, slots: [{ playerId: me, slot }] });
  releaseClaim(d);
  return null;
}

function matchOpponent(d: Draft, me: PlayerId, target: SlotRef, giveSlot: number): GameError | null {
  const windowError = requireReactionWindow(d, me);
  if (windowError) return windowError;
  if (!d.s.rules.reactions.matchOpponent) {
    return gameError('REACTION_DISABLED', 'matchOpponent is switched off for this game');
  }
  const claimError = checkClaim(d, me, 'matchOpponent');
  if (claimError) return claimError;
  const s = d.s;
  const reaction = s.reaction as NonNullable<GameState['reaction']>;
  const targetError = checkOpponentTarget(s, me, target);
  if (targetError) return targetError;
  const player = getPlayer(s, me);
  const giveError = checkOccupiedSlot(player, giveSlot);
  if (giveError) return giveError;
  const opponent = getPlayer(s, target.playerId);
  const theirs = opponent.grid[target.slot] as NonNullable<PlayerState['grid'][number]>;
  const mine = player.grid[giveSlot] as NonNullable<PlayerState['grid'][number]>;
  reaction.attempts.push(me);

  if (sameRank(theirs, reaction.card, s.rules)) {
    // Their card goes to the discard; one of yours takes its place.
    opponent.grid[target.slot] = mine;
    player.grid[giveSlot] = null;
    discard(d, theirs);
    d.events.push({
      type: 'reactionSucceeded',
      reaction: 'matchOpponent',
      playerId: me,
      target: copyRef(target),
      giveSlot,
      card: publicCard(theirs),
    });
    d.events.push({ type: 'reactionResolved', by: me, kind: 'matchOpponent', ok: true, slots: pairSlots(me, giveSlot, target) });
    closeReactionWindow(d, 'matched');
    return null;
  }
  // Wrong: nothing moves; the card you would have given is shown to everyone
  // for a while. The opponent's card stays hidden.
  addReveal(d, mine, 'all');
  d.events.push({
    type: 'reactionFailed',
    reaction: 'matchOpponent',
    playerId: me,
    target: copyRef(target),
    giveSlot,
    revealed: publicCard(mine),
  });
  d.events.push({ type: 'reactionResolved', by: me, kind: 'matchOpponent', ok: false, slots: pairSlots(me, giveSlot, target) });
  releaseClaim(d);
  return null;
}

// --- validation helpers -------------------------------------------------------

function checkOccupiedSlot(player: PlayerState, slot: number): GameError | null {
  if (slot >= player.grid.length) return gameError('INVALID_SLOT', 'slot outside the grid');
  if (!player.grid[slot]) return gameError('EMPTY_SLOT', 'there is no card in that slot');
  return null;
}

function checkOpponentTarget(s: GameState, me: PlayerId, target: SlotRef): GameError | null {
  if (target.playerId === me) return gameError('INVALID_TARGET', 'the target must be an opponent');
  const opponent = findPlayer(s, target.playerId);
  if (!opponent) return gameError('INVALID_TARGET', 'unknown target player');
  return checkOccupiedSlot(opponent, target.slot);
}

function cardAt(s: GameState, ref: SlotRef): NonNullable<PlayerState['grid'][number]> {
  const card = getPlayer(s, ref.playerId).grid[ref.slot];
  if (!card) throw new Error('engine invariant: expected a card');
  return card;
}

function swapCards(s: GameState, a: SlotRef, b: SlotRef): void {
  const gridA = getPlayer(s, a.playerId).grid;
  const gridB = getPlayer(s, b.playerId).grid;
  const cardA = gridA[a.slot] ?? null;
  gridA[a.slot] = gridB[b.slot] ?? null;
  gridB[b.slot] = cardA;
}

function pairSlots(me: PlayerId, giveSlot: number, target: SlotRef): SlotRef[] {
  return [copyRef(target), { playerId: me, slot: giveSlot }];
}

function copyRef(ref: SlotRef): SlotRef {
  return { playerId: ref.playerId, slot: ref.slot };
}

function failure(code: GameError['code'], message: string): EngineResult {
  return { ok: false, error: gameError(code, message) };
}

function assertState(state: GameState): void {
  if (state === null || typeof state !== 'object' || state.schemaVersion !== 1) {
    throw new TypeError('applyAction: not a game state created by createGame');
  }
}
