import type {
  Action,
  Card,
  GameEvent,
  GameView,
  PlayerId,
  PlayerView,
  PowerKind,
  ReactionWindowView,
  SlotRef,
} from '@moises/shared';
import { CardMemory } from './memory.js';

// A simple but reasonable bot. It plays fair: it only ever looks at the
// GameView built for its own seat (viewFor) and at the public events that every
// client receives. This module imports nothing from the engine, so it cannot
// reach the authoritative state even by accident (a test checks the imports).

/** Rules a player knows (card values and powers). Not game state. */
export interface BotKnowledge {
  valueOf(card: Card): number;
  powerOf(card: Card): PowerKind | null;
  sameRank(a: Card, b: Card): boolean;
  /** How many opponent cards the black K shows. */
  readonly peekManyCount: number;
  /** Expected value of a card the bot knows nothing about (deck average). */
  readonly unknownCardValue: number;
}

export interface BotTuning {
  /** Call "Estou foda" when the estimated own total is at most this... */
  readonly endThreshold: number;
  /** ...plus this much for every `relaxEveryTurns` own turns played, so games always end. */
  readonly endThresholdStep: number;
  readonly relaxEveryTurns: number;
  /** Most unknown own cards accepted when calling the end. */
  readonly maxUnknownToCall: number;
  /** Always call the end after this many own turns. */
  readonly forceEndAfterTurns: number;
  /** Put the drawn card on an unknown position when it is worth at most this. */
  readonly lowCardValue: number;
  /** Minimum expected gain to use the blind swap (Q). */
  readonly blindSwapMinGain: number;
  /** Value given to the information of a peek, when comparing with a swap. */
  readonly peekValue: number;
}

export const DEFAULT_BOT_TUNING: BotTuning = Object.freeze({
  endThreshold: 6,
  endThresholdStep: 2,
  relaxEveryTurns: 4,
  maxUnknownToCall: 1,
  forceEndAfterTurns: 30,
  lowCardValue: 4,
  blindSwapMinGain: 3,
  peekValue: 2,
});

interface KnownSlot {
  readonly slot: number;
  readonly card: Card;
  readonly value: number;
}

interface Candidate {
  readonly action: Action;
  readonly gain: number;
}

export class Bot {
  private readonly memory = new CardMemory();
  /** The card the bot drew and is holding (seen in its own view). */
  private holding: Card | null = null;
  private ownTurns = 0;

  constructor(
    readonly id: PlayerId,
    private readonly rules: BotKnowledge,
    private readonly random: () => number,
    private readonly tuning: BotTuning = DEFAULT_BOT_TUNING,
  ) {}

  /** What the bot remembers about a position (for tests and debugging). */
  remembered(playerId: PlayerId, slot: number): Card | null {
    return this.memory.get(playerId, slot) ?? null;
  }

  /** Called after every change with the bot's own view and the public events of that change. */
  observe(view: GameView, events: readonly GameEvent[]): void {
    for (const event of events) this.track(event);
    this.learn(view);
  }

  /** The move the bot wants to make now, or null to wait. Never mutates the memory. */
  decide(view: GameView): Action | null {
    if (view.phase !== 'playing' || view.you !== this.id) return null;
    const me = view.players.find((p) => p.id === this.id);
    if (!me) return null;

    const window = view.reactionWindow;
    if (window && !window.attemptedBy.includes(this.id)) {
      const reaction = this.chooseReaction(view, me, window);
      if (reaction) return reaction;
    }

    const turn = view.turn;
    if (!turn || turn.playerId !== this.id) return null;
    switch (turn.step) {
      case 'draw':
        return this.shouldCallEnd(view, me) ? { type: 'callEnd' } : { type: 'draw' };
      case 'decide':
        return turn.drawnCard ? this.chooseKeepOrDiscard(view, me, turn.drawnCard) : { type: 'discardDrawn' };
      case 'reaction':
        return null;
      case 'power':
        return turn.pendingPower ? this.choosePower(view, me, turn.pendingPower) : { type: 'skipPower' };
      case 'powerSwap':
        return this.choosePowerSwap(me, turn.peeked);
    }
  }

  // --- memory ------------------------------------------------------------------

  private track(event: GameEvent): void {
    switch (event.type) {
      case 'turnStarted':
        if (event.playerId === this.id) this.ownTurns += 1;
        return;
      case 'cardsArranged':
        this.memory.swap({ playerId: event.playerId, slot: event.fromSlot }, { playerId: event.playerId, slot: event.toSlot });
        return;
      case 'drawnCardSwapped':
        if (event.playerId === this.id && this.holding) this.memory.set(this.id, event.slot, this.holding);
        else this.memory.forget(event.playerId, event.slot);
        if (event.playerId === this.id) this.holding = null;
        return;
      case 'drawnCardDiscarded':
        if (event.playerId === this.id) this.holding = null;
        return;
      case 'powerUsed': {
        const target = event.targets[0];
        if (event.power === 'blindSwap' && event.ownSlot !== null && target) {
          this.memory.swap({ playerId: event.playerId, slot: event.ownSlot }, target);
        }
        return;
      }
      case 'powerSwapped':
        this.memory.swap({ playerId: event.playerId, slot: event.ownSlot }, event.target);
        return;
      case 'reactionSucceeded':
        if (event.reaction === 'matchOwn') this.memory.forget(event.playerId, event.slot);
        else this.memory.move({ playerId: event.playerId, slot: event.giveSlot }, event.target);
        return;
      default:
        return;
    }
  }

  private learn(view: GameView): void {
    for (const player of view.players) {
      player.slots.forEach((slot, index) => {
        if (slot.state === 'visible') this.memory.set(player.id, index, slot.card);
        else if (slot.state === 'empty') this.memory.forget(player.id, index);
      });
    }
    if (view.turn?.playerId === this.id && view.turn.drawnCard) this.holding = view.turn.drawnCard;
  }

  // --- decisions -------------------------------------------------------------------

  private chooseReaction(view: GameView, me: PlayerView, window: ReactionWindowView): Action | null {
    // "Filha da putinha": shed a known own card of the same rank (only if it is worth removing).
    let shed: KnownSlot | null = null;
    for (const known of this.knownOwn(me)) {
      if (known.value > 0 && this.rules.sameRank(known.card, window.card) && (!shed || known.value > shed.value)) {
        shed = known;
      }
    }
    if (shed) return { type: 'matchOwn', slot: shed.slot };

    // "Filho da puta": take a known opponent card of the same rank and give away my worst card.
    const give = this.worstOwn(me);
    if (!give || give.value <= 0) return null;
    for (const opponent of this.opponents(view)) {
      for (const slot of occupied(opponent)) {
        const card = this.memory.get(opponent.id, slot);
        if (card && this.rules.sameRank(card, window.card)) {
          return { type: 'matchOpponent', target: { playerId: opponent.id, slot }, giveSlot: give.slot };
        }
      }
    }
    return null;
  }

  private shouldCallEnd(view: GameView, me: PlayerView): boolean {
    if (view.endCall) return false;
    if (this.ownTurns >= this.tuning.forceEndAfterTurns) return true;
    let total = 0;
    let unknown = 0;
    for (const slot of occupied(me)) {
      const card = this.memory.get(this.id, slot);
      if (card) total += this.rules.valueOf(card);
      else {
        unknown += 1;
        total += this.rules.unknownCardValue;
      }
    }
    const threshold =
      this.tuning.endThreshold + Math.floor(this.ownTurns / this.tuning.relaxEveryTurns) * this.tuning.endThresholdStep;
    return unknown <= this.tuning.maxUnknownToCall && total <= threshold;
  }

  private chooseKeepOrDiscard(view: GameView, me: PlayerView, drawn: Card): Action {
    const drawnValue = this.rules.valueOf(drawn);
    const power = this.rules.powerOf(drawn);
    const powerGain = power ? this.powerGain(view, me, power) : 0;
    const candidates: Candidate[] = [{ action: { type: 'discardDrawn' }, gain: powerGain }];

    // Discard it and then shed my own card of the same rank with a reaction.
    const known = this.knownOwn(me);
    const shed = known.filter((k) => k.value > 0 && this.rules.sameRank(k.card, drawn));
    if (shed.length > 0) {
      candidates.push({ action: { type: 'discardDrawn' }, gain: powerGain + Math.max(...shed.map((k) => k.value)) });
    }

    // Replace my worst known card with the drawn one.
    const worstKnown = maxBy(known, (k) => k.value);
    if (worstKnown && worstKnown.value > drawnValue) {
      candidates.push({ action: { type: 'swapWithDrawn', slot: worstKnown.slot }, gain: worstKnown.value - drawnValue });
    }

    // A low card is worth keeping even blind.
    const unknown = this.unknownOwn(me);
    if (unknown.length > 0 && drawnValue <= this.tuning.lowCardValue) {
      candidates.push({
        action: { type: 'swapWithDrawn', slot: this.pick(unknown) },
        gain: this.rules.unknownCardValue - drawnValue,
      });
    }

    return (maxBy(candidates, (c) => c.gain) as Candidate).action;
  }

  /** How much a power is worth right now (0 = not worth using). */
  private powerGain(view: GameView, me: PlayerView, power: PowerKind): number {
    switch (power) {
      case 'peekOwn':
        return this.unknownOwn(me).length > 0 ? this.tuning.peekValue : 0;
      case 'peekOpponent':
        return this.unknownOpponentSlots(view).length > 0 ? this.tuning.peekValue : 0;
      case 'blindSwap':
        return this.bestBlindSwap(view, me)?.gain ?? 0;
      case 'peekAndSwap':
      case 'peekManyAndSwap':
        return this.opponentSlots(view).length > 0 ? this.tuning.peekValue : 0;
    }
  }

  private choosePower(view: GameView, me: PlayerView, power: PowerKind): Action {
    const skip: Action = { type: 'skipPower' };
    switch (power) {
      case 'peekOwn': {
        const unknown = this.unknownOwn(me);
        return unknown.length > 0 ? { type: 'usePower', power, slot: this.pick(unknown) } : skip;
      }
      case 'peekOpponent': {
        const unknown = this.unknownOpponentSlots(view);
        return unknown.length > 0 ? { type: 'usePower', power, target: this.pick(unknown) } : skip;
      }
      case 'blindSwap': {
        const plan = this.bestBlindSwap(view, me);
        return plan ? { type: 'usePower', power, ownSlot: plan.ownSlot, target: plan.target } : skip;
      }
      case 'peekAndSwap': {
        const [target] = this.peekTargets(view, me, 1);
        return target ? { type: 'usePower', power, target } : skip;
      }
      case 'peekManyAndSwap': {
        const count = Math.min(this.rules.peekManyCount, this.opponentSlots(view).length);
        const targets = this.peekTargets(view, me, count);
        return count > 0 && targets.length === count ? { type: 'usePower', power, targets } : skip;
      }
    }
  }

  private choosePowerSwap(me: PlayerView, peeked: readonly SlotRef[]): Action {
    let best: { ref: SlotRef; value: number } | null = null;
    for (const ref of peeked) {
      const card = this.memory.get(ref.playerId, ref.slot);
      if (!card) continue;
      const value = this.rules.valueOf(card);
      if (!best || value < best.value) best = { ref, value };
    }
    const mine = this.worstOwn(me);
    if (best && mine && mine.value - best.value >= 1) {
      return { type: 'powerSwap', ownSlot: mine.slot, target: { playerId: best.ref.playerId, slot: best.ref.slot } };
    }
    return { type: 'skipPower' };
  }

  /** Q: give my worst known card for the best opponent card I know (or a random one). */
  private bestBlindSwap(view: GameView, me: PlayerView): { ownSlot: number; target: SlotRef; gain: number } | null {
    const mine = maxBy(this.knownOwn(me), (k) => k.value);
    if (!mine) return null; // swapping blind for blind gains nothing on average
    const knownTargets = this.knownOpponentSlots(view);
    const bestKnown = minBy(knownTargets, (t) => t.value);
    let target: SlotRef;
    let targetValue: number;
    const unknown = this.unknownOpponentSlots(view);
    if (bestKnown && (bestKnown.value <= this.rules.unknownCardValue || unknown.length === 0)) {
      target = bestKnown.ref;
      targetValue = bestKnown.value;
    } else if (unknown.length > 0) {
      target = this.pick(unknown);
      targetValue = this.rules.unknownCardValue;
    } else {
      return null;
    }
    const gain = mine.value - targetValue;
    return gain >= this.tuning.blindSwapMinGain ? { ownSlot: mine.slot, target, gain } : null;
  }

  /** J / black K: first known cheap cards worth taking, then unknown cards, then the rest. */
  private peekTargets(view: GameView, me: PlayerView, count: number): SlotRef[] {
    const worst = this.worstOwn(me);
    const known = this.knownOpponentSlots(view).sort((a, b) => a.value - b.value);
    const good = worst ? known.filter((t) => worst.value - t.value >= 3).map((t) => t.ref) : [];
    const unknown = this.shuffled(this.unknownOpponentSlots(view));
    const rest = known.map((t) => t.ref);
    const out: SlotRef[] = [];
    const seen = new Set<string>();
    for (const ref of [...good, ...unknown, ...rest]) {
      const key = `${ref.playerId}#${ref.slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
      if (out.length === count) break;
    }
    return out;
  }

  // --- helpers ------------------------------------------------------------------------

  private knownOwn(me: PlayerView): KnownSlot[] {
    const out: KnownSlot[] = [];
    for (const slot of occupied(me)) {
      const card = this.memory.get(this.id, slot);
      if (card) out.push({ slot, card, value: this.rules.valueOf(card) });
    }
    return out;
  }

  private unknownOwn(me: PlayerView): number[] {
    return occupied(me).filter((slot) => !this.memory.get(this.id, slot));
  }

  /** My position with the highest expected value (known value, or the deck average when unknown). */
  private worstOwn(me: PlayerView): { slot: number; value: number } | null {
    const slots = occupied(me).map((slot) => {
      const card = this.memory.get(this.id, slot);
      return { slot, value: card ? this.rules.valueOf(card) : this.rules.unknownCardValue };
    });
    return maxBy(slots, (s) => s.value);
  }

  private opponents(view: GameView): PlayerView[] {
    return view.players.filter((p) => p.id !== this.id);
  }

  private opponentSlots(view: GameView): SlotRef[] {
    return this.opponents(view).flatMap((p) => occupied(p).map((slot) => ({ playerId: p.id, slot })));
  }

  private unknownOpponentSlots(view: GameView): SlotRef[] {
    return this.opponentSlots(view).filter((ref) => !this.memory.get(ref.playerId, ref.slot));
  }

  private knownOpponentSlots(view: GameView): { ref: SlotRef; value: number }[] {
    const out: { ref: SlotRef; value: number }[] = [];
    for (const ref of this.opponentSlots(view)) {
      const card = this.memory.get(ref.playerId, ref.slot);
      if (card) out.push({ ref, value: this.rules.valueOf(card) });
    }
    return out;
  }

  private pick<T>(items: readonly T[]): T {
    const index = Math.min(items.length - 1, Math.floor(this.random() * items.length));
    return items[index] as T;
  }

  private shuffled<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

function occupied(player: PlayerView): number[] {
  const out: number[] = [];
  player.slots.forEach((slot, index) => {
    if (slot.state !== 'empty') out.push(index);
  });
  return out;
}

/** First item with the highest score (stable), or null for an empty list. */
function maxBy<T>(items: readonly T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

function minBy<T>(items: readonly T[], score: (item: T) => number): T | null {
  return maxBy(items, (item) => -score(item));
}
