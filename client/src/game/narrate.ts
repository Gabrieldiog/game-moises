import type { GameView, PlayerId, ReactionKind, ServerGameEvent, SlotRef } from '@moises/shared';
import { POWER_TEXT, SAY, T, cardShort } from '../i18n/pt-BR';
import type { SoundName } from '../sound/sounds';
import { playerName } from './selectors';

// Turns the public events of one GameUpdate into what the table tells people:
// "beats" (one thing at a time on the felt: a balloon, an eye over a card, two
// cards flying) and lines for the history. Pure: no DOM, no clock. It only
// describes what the server already decided; nothing here changes the game.

export type FeedIcon = 'turn' | 'draw' | 'discard' | 'keep' | 'eye' | 'swap' | 'shout' | 'hit' | 'miss' | 'power' | 'skip' | 'end' | 'clock' | 'deck';

export interface FeedLine {
  readonly icon: FeedIcon;
  readonly text: string;
  /** mine: you did it or it hit you; hot: a reaction; calm: the rest. */
  readonly tone: 'mine' | 'hot' | 'calm';
}

export type Beat =
  /** Someone looked at a position: an eye over that card. */
  | { readonly kind: 'peek'; readonly by: PlayerId; readonly target: SlotRef; readonly text: string }
  /** Two positions exchanged cards: both cards fly to the other place. */
  | { readonly kind: 'swap'; readonly by: PlayerId; readonly a: SlotRef; readonly b: SlotRef; readonly blind: boolean; readonly text: string }
  /** A shout claimed the reaction window. */
  | { readonly kind: 'claim'; readonly by: PlayerId; readonly reaction: ReactionKind; readonly text: string }
  /** A reaction's verdict, with the positions involved. */
  | { readonly kind: 'resolve'; readonly by: PlayerId; readonly reaction: ReactionKind; readonly ok: boolean; readonly slots: readonly SlotRef[]; readonly text: string }
  /** Anything else worth a balloon (a power skipped, a card kept from the deck...). */
  | { readonly kind: 'note'; readonly by: PlayerId | null; readonly focus: readonly SlotRef[]; readonly text: string };

export interface Narration {
  readonly beats: readonly Beat[];
  readonly lines: readonly FeedLine[];
  /** Sounds that go with things already animated at once (draws, discards, your turn). */
  readonly sounds: readonly SoundName[];
}

export function shoutText(kind: ReactionKind): string {
  return kind === 'matchOwn' ? T.shoutOwn : T.shoutOpponent;
}

/** The sound of a beat, played when the beat comes on screen. */
export function beatSound(beat: Beat): SoundName | null {
  switch (beat.kind) {
    case 'peek':
      return 'flip';
    case 'swap':
      return 'swap';
    case 'claim':
      return 'shout';
    case 'resolve':
      return beat.ok ? 'hit' : 'miss';
    case 'note':
      return null;
  }
}

export function narrate(events: readonly ServerGameEvent[], view: GameView): Narration {
  const me = view.you;
  const who = (id: PlayerId): string => (id === me ? T.you : playerName(view, id));
  const place = (ref: SlotRef, by: PlayerId | null): string =>
    SAY.place(ref.slot, ref.playerId === me ? 'you' : ref.playerId === by ? 'self' : playerName(view, ref.playerId));
  const touchesMe = (...refs: SlotRef[]) => refs.some((r) => r.playerId === me);

  const beats: Beat[] = [];
  const lines: FeedLine[] = [];
  const sounds: SoundName[] = [];
  const line = (icon: FeedIcon, text: string, tone: FeedLine['tone'] = 'calm') => lines.push({ icon, text, tone });

  // Detailed events win over summaries of the same thing in this batch.
  const detailed = new Set<PlayerId>();
  const verdictBy = new Set<PlayerId>();
  const resolvedBy = new Set<PlayerId>();
  for (const e of events) {
    if (e.type === 'cardPeeked' || e.type === 'cardsSwapped') detailed.add(e.by);
    if (e.type === 'reactionSucceeded' || e.type === 'reactionFailed') verdictBy.add(e.playerId);
    if (e.type === 'reactionResolved') resolvedBy.add(e.by);
  }

  for (const e of events) {
    switch (e.type) {
      case 'phaseChanged':
        if (e.phase === 'initialPeek') {
          line('eye', SAY.peekPhase);
          sounds.push('flip');
        }
        break;
      case 'turnStarted':
        line('turn', SAY.turn(who(e.playerId)), e.playerId === me ? 'mine' : 'calm');
        if (e.playerId === me) sounds.push('turn');
        break;
      case 'cardDrawn':
        line('draw', SAY.drew(who(e.playerId)), e.playerId === me ? 'mine' : 'calm');
        sounds.push('draw');
        break;
      case 'deckReshuffled':
        line('deck', SAY.reshuffled);
        break;
      case 'drawnCardSwapped': {
        const ref = { playerId: e.playerId, slot: e.slot };
        const text = SAY.keptDrawn(who(e.playerId), place(ref, e.playerId), cardShort(e.discarded));
        line('keep', text, e.playerId === me ? 'mine' : 'calm');
        if (e.playerId !== me) beats.push({ kind: 'note', by: e.playerId, focus: [ref], text });
        sounds.push('discard');
        break;
      }
      case 'drawnCardDiscarded':
        line('discard', SAY.discarded(who(e.playerId), cardShort(e.card)), e.playerId === me ? 'mine' : 'calm');
        sounds.push('discard');
        break;
      case 'powerUsed':
        if (!detailed.has(e.by)) line('power', SAY.powerUsed(who(e.by), POWER_TEXT[e.power].name.toLowerCase()), e.by === me ? 'mine' : 'calm');
        break;
      case 'cardPeeked': {
        const text = SAY.peeked(who(e.by), place(e.target, e.by));
        line('eye', text, e.by === me || touchesMe(e.target) ? 'mine' : 'calm');
        beats.push({ kind: 'peek', by: e.by, target: e.target, text });
        break;
      }
      case 'cardsSwapped': {
        const say = e.blind ? SAY.swappedBlind : SAY.swapped;
        const text = say(who(e.by), place(e.a, e.by), place(e.b, e.by));
        line('swap', text, e.by === me || touchesMe(e.a, e.b) ? 'mine' : 'calm');
        beats.push({ kind: 'swap', by: e.by, a: e.a, b: e.b, blind: e.blind, text });
        break;
      }
      case 'powerSkipped': {
        const power = POWER_TEXT[e.power].name.toLowerCase();
        const text = e.reason === 'unusable' ? SAY.powerUnusable(who(e.by), power) : SAY.powerSkipped(who(e.by), power);
        line('skip', text, e.by === me ? 'mine' : 'calm');
        if (e.by !== me) beats.push({ kind: 'note', by: e.by, focus: [], text });
        break;
      }
      case 'reactionClaimed': {
        const text = SAY.claimed(who(e.by), shoutText(e.kind));
        line('shout', text, 'hot');
        beats.push({ kind: 'claim', by: e.by, reaction: e.kind, text });
        break;
      }
      case 'reactionSucceeded': {
        const text =
          e.reaction === 'matchOwn'
            ? SAY.hitOwn(who(e.playerId), cardShort(e.card))
            : SAY.hitOpp(who(e.playerId), cardShort(e.card), place(e.target, e.playerId));
        line('hit', text, 'hot');
        if (!resolvedBy.has(e.playerId)) {
          const slots = e.reaction === 'matchOwn' ? [{ playerId: e.playerId, slot: e.slot }] : [e.target, { playerId: e.playerId, slot: e.giveSlot }];
          beats.push({ kind: 'resolve', by: e.playerId, reaction: e.reaction, ok: true, slots, text });
        }
        break;
      }
      case 'reactionFailed': {
        const text = SAY.missed(who(e.playerId), cardShort(e.revealed));
        line('miss', text, 'hot');
        if (!resolvedBy.has(e.playerId)) {
          const slots = e.reaction === 'matchOwn' ? [{ playerId: e.playerId, slot: e.slot }] : [e.target, { playerId: e.playerId, slot: e.giveSlot }];
          beats.push({ kind: 'resolve', by: e.playerId, reaction: e.reaction, ok: false, slots, text });
        }
        break;
      }
      case 'reactionResolved': {
        const text = e.ok ? SAY.resolvedOk(who(e.by)) : e.slots.length === 0 ? SAY.claimExpired : SAY.resolvedMiss(who(e.by));
        if (!verdictBy.has(e.by)) line(e.ok ? 'hit' : 'miss', text, 'hot');
        beats.push({ kind: 'resolve', by: e.by, reaction: e.kind, ok: e.ok, slots: e.slots, text });
        break;
      }
      case 'endCalled': {
        const text = SAY.endCalled(who(e.playerId));
        line('end', text, 'hot');
        if (e.playerId !== me) beats.push({ kind: 'note', by: e.playerId, focus: [], text });
        break;
      }
      case 'turnTimedOut':
        line('clock', SAY.timedOut(who(e.playerId)), e.playerId === me ? 'mine' : 'calm');
        break;
      case 'gameEnded':
        line('end', SAY.gameEnded);
        sounds.push(me !== null && e.result.winners.includes(me) ? 'win' : 'flip');
        break;
      default:
        break;
    }
  }
  return { beats, lines, sounds };
}
