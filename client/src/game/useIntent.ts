import { useState } from 'react';
import type { Action, GameView, SlotRef } from '@moises/shared';
import {
  NO_PICKS,
  arrangeAction,
  pickPolicy,
  shoutAction,
  toggleOpponent,
  toggleOwn,
  type PickPolicy,
  type Picks,
  type Shout,
} from './intent';
import { contextKey, type UiContext } from './selectors';

interface IntentState {
  readonly key: string;
  readonly picks: Picks;
  readonly shout: Shout | null;
}

export interface Intent {
  readonly picks: Picks;
  readonly shout: Shout | null;
  readonly policy: PickPolicy;
  pickOwn(slot: number): void;
  pickOpponent(ref: SlotRef): void;
  /** "Filha da putinha" / "Filho da puta": sends at once if the needed cards are picked, otherwise asks for them. */
  pressShout(shout: Shout): void;
  cancel(): void;
  /** Sends an action and clears the selection. */
  dispatch(action: Action): void;
}

/**
 * Card selection for the current moment of the game. The selection resets
 * whenever the moment changes (new step, new turn, new reaction window).
 */
export function useIntent(view: GameView, ctx: UiContext, send: (action: Action) => void): Intent {
  const key = contextKey(view, ctx);
  const [state, setState] = useState<IntentState>({ key, picks: NO_PICKS, shout: null });
  const current: IntentState = state.key === key ? state : { key, picks: NO_PICKS, shout: null };
  if (state.key !== key) setState(current);
  const policy = pickPolicy(ctx, current.shout);

  const dispatch = (action: Action) => {
    send(action);
    setState({ key, picks: NO_PICKS, shout: null });
  };

  const settle = (picks: Picks) => {
    if (ctx.kind === 'arrange') {
      const action = arrangeAction(picks);
      if (action) {
        dispatch(action);
        return;
      }
    }
    if (ctx.kind === 'reaction' && current.shout) {
      const action = shoutAction(current.shout, picks);
      if (action) {
        dispatch(action);
        return;
      }
    }
    setState({ ...current, picks });
  };

  return {
    picks: current.picks,
    shout: current.shout,
    policy,
    pickOwn: (slot) => settle(toggleOwn(current.picks, slot, policy)),
    pickOpponent: (ref) => settle(toggleOpponent(current.picks, ref, policy)),
    pressShout: (shout) => {
      const action = shoutAction(shout, current.picks);
      if (action) dispatch(action);
      else setState({ ...current, shout });
    },
    cancel: () => setState({ key, picks: NO_PICKS, shout: null }),
    dispatch,
  };
}
