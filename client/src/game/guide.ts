import type { GameView } from '@moises/shared';
import { POWER_TEXT, T, cardShort } from '../i18n/pt-BR';
import { peekManyTargets, type Picks } from './intent';
import type { UiContext } from './selectors';

// Step-by-step guide for the choices that take more than one tap: powers and
// a claimed reaction. It only explains the shape of the move; the server
// decides if it is valid and what it does.

export type StepState = 'done' | 'now' | 'todo';

export interface GuideStep {
  readonly text: string;
  readonly state: StepState;
}

export interface Guide {
  readonly title: string;
  readonly steps: readonly GuideStep[];
  readonly tone: 'power' | 'claim';
}

function steps(texts: readonly string[], now: number): GuideStep[] {
  return texts.map((text, i) => ({ text, state: i < now ? 'done' : i === now ? 'now' : 'todo' }));
}

export function guideFor(view: GameView, ctx: UiContext, picks: Picks): Guide | null {
  const g = T.guide;
  // The face-up card that gave the power (public), to name it ("Poder do Q♥").
  const source = view.discardTop;
  const title = (power: keyof typeof POWER_TEXT) =>
    source ? g.powerOf(cardShort(source), POWER_TEXT[power].name.toLowerCase()) : g.power(POWER_TEXT[power].name.toLowerCase());
  const own = picks.own.length > 0;
  const opp = picks.opponents.length;

  switch (ctx.kind) {
    case 'myPower':
      switch (ctx.power) {
        case 'peekOwn':
          return { title: title(ctx.power), tone: 'power', steps: steps([g.tapOwn, g.seeOwn], own ? 1 : 0) };
        case 'peekOpponent':
          return { title: title(ctx.power), tone: 'power', steps: steps([g.tapOpp, g.seeOpp], opp > 0 ? 1 : 0) };
        case 'blindSwap':
          return { title: title(ctx.power), tone: 'power', steps: steps([g.tapOwn, g.tapOpp, g.blindChoice], !own ? 0 : opp === 0 ? 1 : 2) };
        case 'peekAndSwap':
          return { title: title(ctx.power), tone: 'power', steps: steps([g.tapOpp, g.peek, g.decideSwap], opp > 0 ? 1 : 0) };
        case 'peekManyAndSwap': {
          const total = peekManyTargets(ctx.targetCount);
          const full = ctx.targetCount === null ? opp > 0 : opp >= total;
          return { title: title(ctx.power), tone: 'power', steps: steps([g.tapOpps(opp, total), g.peek, g.decideSwap], full ? 1 : 0) };
        }
      }
      return null;
    case 'myPowerSwap': {
      const power = view.turn?.pendingPower ?? 'peekAndSwap';
      if (ctx.peeked.length > 1) {
        return { title: title(power), tone: 'power', steps: steps([g.peeked, g.tapPeeked, g.tapOwn, g.swapChoice], opp === 0 ? 1 : !own ? 2 : 3) };
      }
      return { title: title(power), tone: 'power', steps: steps([g.peeked, g.tapOwn, g.swapChoice], own ? 2 : 1) };
    }
    case 'claim': {
      const card = view.reactionWindow ? cardShort(view.reactionWindow.card) : '';
      if (ctx.reaction === 'matchOwn') {
        return { title: T.claimGuide, tone: 'claim', steps: steps([g.shouted, g.tapOwnMatch(card)], 1) };
      }
      return { title: T.claimGuide, tone: 'claim', steps: steps([g.shouted, g.tapOppMatch(card), g.tapGive], opp === 0 ? 1 : 2) };
    }
    default:
      return null;
  }
}
