import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Action, GameView } from '@moises/shared';
import {
  powerSwapAction,
  swapWithDrawnAction,
  usePowerAction,
  type Picks,
  type Shout,
} from '../game/intent';
import { canOfferCallEnd, contextKey, type UiContext } from '../game/selectors';
import { POWER_TEXT, T } from '../i18n/pt-BR';
import { cx } from './cx';

export interface ActionBarProps {
  readonly ctx: UiContext;
  readonly picks: Picks;
  readonly shout: Shout | null;
  readonly onSend: (action: Action) => void;
  readonly onShout: (shout: Shout) => void;
  readonly onCancel: () => void;
}

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

/**
 * Only what the current moment allows. Buttons build typed actions from the
 * selected cards; the server still validates every one of them.
 */
export function ActionBar({ ctx, picks, shout, onSend, onShout, onCancel }: ActionBarProps) {
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
      row = (
        <div className="shouts" role="group" aria-label="Reações">
          <button
            type="button"
            className={cx('shout', 'shout--own', shout === 'matchOwn' && 'is-armed')}
            disabled={!ctx.canReact}
            onClick={() => onShout('matchOwn')}
          >
            <span className="shout__text">{T.shoutOwn}</span>
            <span className="shout__hint">{T.shoutOwnHint}</span>
          </button>
          <button
            type="button"
            className={cx('shout', 'shout--opp', shout === 'matchOpponent' && 'is-armed')}
            disabled={!ctx.canReact}
            onClick={() => onShout('matchOpponent')}
          >
            <span className="shout__text">{T.shoutOpponent}</span>
            <span className="shout__hint">{T.shoutOpponentHint}</span>
          </button>
        </div>
      );
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
 * It cannot be undone, so it opens a confirmation before sending.
 */
export function CallEndButton({ view, ctx, onSend }: CallEndButtonProps) {
  const key = contextKey(view, ctx);
  const [openAt, setOpenAt] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const open = openAt === key && canOfferCallEnd(view);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);
  if (!canOfferCallEnd(view)) return null;

  return (
    <>
      <button
        type="button"
        className={cx('shout', 'shout--end', open && 'is-armed')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpenAt(open ? null : key)}
      >
        <span className="shout__text">{T.callEnd}</span>
        <span className="shout__hint">{T.callEndHint}</span>
      </button>
      {open && (
        <div
          className="confirm"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="confirm-end-title"
          aria-describedby="confirm-end-hint"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpenAt(null);
          }}
        >
          <p id="confirm-end-title" className="confirm__title">
            {T.callEndQuestion}
          </p>
          <p id="confirm-end-hint" className="confirm__hint">
            {T.callEndHint}
          </p>
          <div className="confirm__row">
            <button type="button" className="btn btn--ghost" onClick={() => setOpenAt(null)}>
              {T.cancel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="shout shout--end shout--confirm"
              onClick={() => {
                setOpenAt(null);
                onSend({ type: 'callEnd' });
              }}
            >
              <span className="shout__text">{T.callEndConfirm}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
