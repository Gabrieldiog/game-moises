import { useState } from 'react';
import type { Action, GameView, ReactionKind, SlotRef } from '@moises/shared';
import {
  NO_PICKS,
  arrangeAction,
  pickPolicy,
  shoutAction,
  toggleOpponent,
  toggleOwn,
  type PickPolicy,
  type Picks,
} from './intent';
import { contextKey, type UiContext } from './selectors';

interface IntentState {
  readonly key: string;
  readonly picks: Picks;
  /** A shout sent and not yet answered by the server (the claim arrives in the next view). */
  readonly claiming: ReactionKind | null;
}

export interface Intent {
  readonly picks: Picks;
  /** The shout you just pressed, while the server has not answered yet. */
  readonly claiming: ReactionKind | null;
  readonly policy: PickPolicy;
  pickOwn(slot: number): void;
  pickOpponent(ref: SlotRef): void;
  /**
   * "Filha da putinha!" / "Filho da puta!": step 1 claims the window
   * (claimReaction); once the server gives it to you, tapping the cards sends
   * the reaction itself.
   */
  pressShout(kind: ReactionKind): void;
  /** Clears the cards chosen so far in this step. */
  cancel(): void;
  /** Sends an action and clears the selection. */
  dispatch(action: Action): void;
}

/**
 * Card selection for the current moment of the game. The selection resets
 * whenever the moment changes (new step, new turn, new reaction window, a claim).
 */
export function useIntent(view: GameView, ctx: UiContext, send: (action: Action) => void): Intent {
  const key = contextKey(view, ctx);
  const [state, setState] = useState<IntentState>({ key, picks: NO_PICKS, claiming: null });
  const current: IntentState = state.key === key ? state : { key, picks: NO_PICKS, claiming: null };
  if (state.key !== key) setState(current);
  const policy = pickPolicy(ctx, current.picks);

  const dispatch = (action: Action) => {
    send(action);
    setState({ key, picks: NO_PICKS, claiming: null });
  };

  const settle = (picks: Picks) => {
    if (ctx.kind === 'arrange') {
      const action = arrangeAction(picks);
      if (action) {
        dispatch(action);
        return;
      }
    }
    if (ctx.kind === 'claim') {
      const action = shoutAction(ctx.reaction, picks);
      if (action) {
        dispatch(action);
        return;
      }
    }
    setState({ ...current, picks });
  };

  return {
    picks: current.picks,
    claiming: current.claiming,
    policy,
    pickOwn: (slot) => settle(toggleOwn(current.picks, slot, policy)),
    pickOpponent: (ref) => settle(toggleOpponent(current.picks, ref, policy)),
    pressShout: (kind) => {
      send({ type: 'claimReaction', kind });
      setState({ key, picks: NO_PICKS, claiming: kind });
    },
    cancel: () => setState({ key, picks: NO_PICKS, claiming: null }),
    dispatch,
  };
}
