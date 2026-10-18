import type { ReactNode } from 'react';
import type { Action, GameView, TableSettingsView } from '@moises/shared';
import {
  powerSwapAction,
  swapWithDrawnAction,
  usePowerAction,
  type Picks,
  type Shout,
} from '../game/intent';
import { canOfferCallEnd, type UiContext } from '../game/selectors';
import { POWER_TEXT, T } from '../i18n/pt-BR';
import { cx } from './cx';

export interface ActionBarProps {
  readonly ctx: UiContext;
  readonly picks: Picks;
  readonly shout: Shout | null;
  readonly onSend: (action: Action) => void;
  readonly onShout: (shout: Shout) => void;
  readonly onCancel: () => void;
  /** Attempts in the open reaction window (ReactionWindowView): left for you (null = spectator) of the total each player gets. */
  readonly attempts?: { readonly left: number | null; readonly total: number } | null;
  /** Reactions switched on at this table (RoomView.table); both on when unknown. */
  readonly reactions?: TableSettingsView['reactions'];
}

const ALL_REACTIONS: TableSettingsView['reactions'] = { matchOwn: true, matchOpponent: true };

function Btn({
  children,
  onClick,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={cx('btn', primary ? 'btn--primary' : 'btn--ghost')} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Attempts left in this reaction window, as filled/empty dots with the number for screen readers. */
function Pips({ attempts }: { attempts: ActionBarProps['attempts'] }) {
  if (!attempts || attempts.left === null || attempts.total <= 0) return null;
  const total = Math.min(attempts.total, 6);
  return (
    <span className="shout__pips" title={T.attemptsLeft(attempts.left)}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx('pip', i < attempts.left! && 'is-on')} aria-hidden="true" />
      ))}
      <span className="sr-only">{T.attemptsLeft(attempts.left)}</span>
    </span>
  );
}

/**
 * Only what the current moment allows. Buttons build typed actions from the
 * selected cards; the server still validates every one of them.
 */
export function ActionBar({ ctx, picks, shout, onSend, onShout, onCancel, attempts = null, reactions = ALL_REACTIONS }: ActionBarProps) {
  let row: ReactNode = null;
  switch (ctx.kind) {
    case 'myDraw':
      row = (
        <Btn primary onClick={() => onSend({ type: 'draw' })}>
          {T.draw}
        </Btn>
      );
      break;
    case 'myDecide': {
      const swap = swapWithDrawnAction(picks);
      const slot = picks.own[0];
      row = (
        <>
          <Btn primary disabled={!swap} onClick={() => swap && onSend(swap)}>
            {slot === undefined ? T.swapPick : T.swapWith(slot)}
          </Btn>
          <Btn onClick={() => onSend({ type: 'discardDrawn' })}>{T.discardDrawn}</Btn>
        </>
      );
      break;
    }
    case 'myPower': {
      const action = usePowerAction(ctx.power, picks, ctx.targetCount);
      const text = POWER_TEXT[ctx.power];
      const many = ctx.power === 'peekManyAndSwap';
      const count = ctx.targetCount !== null ? T.pickedOf(picks.opponents.length, ctx.targetCount) : String(picks.opponents.length);
      row = (
        <>
          <Btn primary disabled={!action} onClick={() => action && onSend(action)}>
            {many && (picks.opponents.length > 0 || ctx.targetCount !== null) ? `${text.confirm} (${count})` : text.confirm}
          </Btn>
          <Btn onClick={() => onSend({ type: 'skipPower' })}>{T.skipPower}</Btn>
        </>
      );
      break;
    }
    case 'myPowerSwap': {
      const action = powerSwapAction(picks, ctx.peeked);
      row = (
        <>
          <Btn primary disabled={!action} onClick={() => action && onSend(action)}>
            {T.powerSwap}
          </Btn>
          <Btn onClick={() => onSend({ type: 'skipPower' })}>{T.keepAsIs}</Btn>
        </>
      );
      break;
    }
    case 'reaction':
      // A reaction switched off at this table is not offered at all (the server refuses it with REACTION_DISABLED).
      row =
        reactions.matchOwn || reactions.matchOpponent ? (
          <div className={cx('shouts', !(reactions.matchOwn && reactions.matchOpponent) && 'shouts--one')} role="group" aria-label="Reações">
            {reactions.matchOwn && (
              <button
                type="button"
                className={cx('shout', 'shout--own', shout === 'matchOwn' && 'is-armed')}
                disabled={!ctx.canReact}
                onClick={() => onShout('matchOwn')}
              >
                <span className="shout__text">{T.shoutOwn}</span>
                <span className="shout__hint">{T.shoutOwnHint}</span>
                <Pips attempts={attempts} />
              </button>
            )}
            {reactions.matchOpponent && (
              <button
                type="button"
                className={cx('shout', 'shout--opp', shout === 'matchOpponent' && 'is-armed')}
                disabled={!ctx.canReact}
                onClick={() => onShout('matchOpponent')}
              >
                <span className="shout__text">{T.shoutOpponent}</span>
                <span className="shout__hint">{T.shoutOpponentHint}</span>
                <Pips attempts={attempts} />
              </button>
            )}
          </div>
        ) : null;
      break;
    default:
      row = null;
  }

  if (row === null && shout === null) return null;

  return (
    <div className={cx('actionbar', ctx.kind === 'reaction' && 'actionbar--reaction')} aria-label="Ações">
      {shout && (
        <div className="actionbar__prompt">
          <span>{shout === 'matchOwn' ? T.shoutOwnPick : picks.opponents.length === 0 ? T.shoutOpponentPickTarget : T.shoutOpponentPickGive}</span>
          <button type="button" className="btn btn--link" onClick={onCancel}>
            {T.cancel}
          </button>
        </div>
      )}
      {row && <div className="actionbar__row">{row}</div>}
    </div>
  );
}

export interface CallEndButtonProps {
  readonly view: GameView;
  readonly ctx: UiContext;
  readonly onSend: (action: Action) => void;
}

/**
 * "Estou foda", offered during your own turn while nobody called the end.
 * One tap sends it (the owner of the game asked for no confirmation).
 */
export function CallEndButton({ view, onSend }: CallEndButtonProps) {
  if (!canOfferCallEnd(view)) return null;
  return (
    <button type="button" className="shout shout--end" title={T.callEndHint} onClick={() => onSend({ type: 'callEnd' })}>
      <span className="shout__text">{T.callEnd}</span>
      <span className="sr-only">{T.callEndHint}</span>
    </button>
  );
}
