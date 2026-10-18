import type { GameView } from '@moises/shared';
import { POWER_TEXT, T, cardShort } from '../i18n/pt-BR';
import type { Picks } from './intent';
import { playerName, type UiContext } from './selectors';

export interface StatusLines {
  readonly title: string;
  readonly hint: string | null;
  /** mine: your move; hot: reaction window; calm: watching. */
  readonly tone: 'mine' | 'hot' | 'calm';
}

function nameOrYou(view: GameView, id: string): string {
  return id === view.you ? T.you : playerName(view, id);
}

/** Headline and hint of the status bar for the current moment. */
export function statusLines(view: GameView, ctx: UiContext, picks: Picks): StatusLines {
  switch (ctx.kind) {
    case 'ended':
      return { title: T.endTitle, hint: view.result ? T.endReason[view.result.reason] : null, tone: 'calm' };
    case 'spectator':
      return {
        title: view.turn ? T.turnOf(playerName(view, view.turn.playerId)) : T.spectating,
        hint: T.spectating,
        tone: 'calm',
      };
    case 'arrange': {
      const first = picks.own[0];
      return { title: T.arrangeTitle, hint: first === undefined ? T.arrangeHint : T.arrangeSelected(first), tone: 'mine' };
    }
    case 'initialPeek':
      return { title: T.peekTitle, hint: T.peekHint, tone: 'mine' };
    case 'myDraw':
      return { title: T.yourTurn, hint: T.drawHint, tone: 'mine' };
    case 'myDecide':
      return { title: T.yourTurn, hint: T.decideHint, tone: 'mine' };
    case 'myPower':
      return {
        title: T.powerTitle(POWER_TEXT[ctx.power].name),
        hint: ctx.power === 'peekManyAndSwap' && ctx.targetCount !== null ? T.peekManyHint(ctx.targetCount) : POWER_TEXT[ctx.power].hint,
        tone: 'mine',
      };
    case 'myPowerSwap':
      return {
        title: T.powerSwapTitle,
        hint: ctx.peeked.length === 1 ? T.powerSwapHintOne : T.powerSwapHint,
        tone: 'mine',
      };
    case 'reaction': {
      const window = view.reactionWindow;
      const discarded = window ? T.reactionHint(nameOrYou(view, window.openedBy), cardShort(window.card)) : null;
      // While a shout is waiting for cards, the action bar says what to tap.
      const extra = ctx.canReact
        ? null
        : window && view.you !== null && window.attemptedBy.includes(view.you)
          ? T.reactionDone
          : T.reactionClosed;
      return { title: T.reactionTitle, hint: [discarded, extra].filter(Boolean).join(' '), tone: 'hot' };
    }
    case 'waiting': {
      const turn = view.turn;
      if (!turn || ctx.playerId === null) return { title: T.spectating, hint: null, tone: 'calm' };
      const name = playerName(view, ctx.playerId);
      const hint =
        turn.step === 'draw'
          ? T.waitingDraw
          : turn.step === 'decide'
            ? T.waitingDecide
            : turn.step === 'power' && turn.pendingPower
              ? T.waitingPower(POWER_TEXT[turn.pendingPower].name)
              : turn.step === 'powerSwap'
                ? T.waitingPowerSwap
                : null;
      return { title: T.turnOf(name), hint, tone: 'calm' };
    }
  }
}

/** Banner text once someone said "Estou foda" (or ran out of cards). */
export function endCallLines(view: GameView): { title: string; hint: string | null } | null {
  const call = view.endCall;
  if (!call || view.phase === 'ended') return null;
  const title =
    call.reason === 'noCards'
      ? T.endNoCards(nameOrYou(view, call.callerId))
      : call.callerId === view.you
        ? T.endCalledYou
        : T.endCalled(playerName(view, call.callerId));
  const pending = call.pending.map((id) => nameOrYou(view, id));
  return { title, hint: pending.length > 0 ? T.endPending(pending.join(', ')) : null };
}
