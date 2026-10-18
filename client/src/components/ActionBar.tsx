import type { ReactNode } from 'react';
import type { Action, GameView, ReactionKind, TableSettingsView } from '@moises/shared';
import { guideFor, type Guide } from '../game/guide';
import {
  peekManyTargets,
  powerSwapAction,
  swapWithDrawnAction,
  usePowerAction,
  type Picks,
} from '../game/intent';
import { canOfferCallEnd, playerName, type ReactionOffer, type UiContext } from '../game/selectors';
import { POWER_TEXT, T } from '../i18n/pt-BR';
import { cx } from './cx';
import { Icon } from './Icon';

export interface ActionBarProps {
  readonly view: GameView;
  readonly ctx: UiContext;
  readonly picks: Picks;
  /** The open reaction window as you can use it (selectors.reactionOffer); null when none. */
  readonly offer?: ReactionOffer | null;
  /** A shout sent and not yet answered. */
  readonly claiming?: ReactionKind | null;
  readonly onSend: (action: Action) => void;
  /** Step 1 of a reaction: claims the window (claimReaction). */
  readonly onShout: (kind: ReactionKind) => void;
  /** Clears the cards chosen in this step. */
  readonly onRestart: () => void;
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
function Pips({ left, total }: { left: number | null; total: number }) {
  if (left === null || total <= 0) return null;
  const shown = Math.min(total, 6);
  return (
    <span className="shout__pips" title={T.attemptsLeft(left)}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className={cx('pip', i < left && 'is-on')} aria-hidden="true" />
      ))}
      <span className="sr-only">{T.attemptsLeft(left)}</span>
    </span>
  );
}

/** The numbered steps of a power or a claimed reaction; the current one stands out. */
export function GuidePanel({ guide, canRestart, onRestart }: { guide: Guide; canRestart: boolean; onRestart: () => void }) {
  const current = guide.steps.findIndex((s) => s.state === 'now');
  return (
    <section className={cx('guide', `guide--${guide.tone}`)} aria-label={guide.title}>
      <ol className="guide__steps">
        {guide.steps.map((step, i) => (
          <li key={i} className={cx('guide__step', `is-${step.state}`)} aria-current={step.state === 'now' ? 'step' : undefined}>
            <span className="guide__num" aria-hidden="true">
              {step.state === 'done' ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="guide__text">{step.text}</span>
            {step.state === 'done' && <span className="sr-only">({T.guide.done})</span>}
          </li>
        ))}
        {canRestart && (
          <li className="guide__tail">
            <button type="button" className="btn btn--link guide__restart" onClick={onRestart}>
              {T.restart}
            </button>
          </li>
        )}
      </ol>
      {current >= 0 && <p className="sr-only" aria-live="polite">{`${T.guide.stepLabel(current + 1, guide.steps.length)}: ${guide.steps[current]?.text ?? ''}`}</p>}
    </section>
  );
}

function Shouts({
  view,
  offer,
  claiming,
  reactions,
  onShout,
}: {
  view: GameView;
  offer: ReactionOffer;
  claiming: ReactionKind | null;
  reactions: TableSettingsView['reactions'];
  onShout: (kind: ReactionKind) => void;
}) {
  if (!reactions.matchOwn && !reactions.matchOpponent) return null;
  const other = offer.claimedBy !== null && !offer.mine ? offer.claimedBy : null;
  const enabled = offer.canShout && claiming === null;
  const why =
    other !== null
      ? T.claimedByOther(playerName(view, other))
      : offer.open && offer.attemptsLeft === 0
        ? T.noAttempts
        : !offer.open
          ? T.reactionClosed
          : null;
  const button = (kind: ReactionKind) => (
    <button
      type="button"
      className={cx('shout', kind === 'matchOwn' ? 'shout--own' : 'shout--opp', claiming === kind && 'is-armed', other !== null && 'is-locked')}
      disabled={!enabled}
      onClick={() => onShout(kind)}
    >
      <span className="shout__text">{claiming === kind ? T.shoutSending : kind === 'matchOwn' ? T.shoutOwn : T.shoutOpponent}</span>
      <span className="shout__hint">{kind === 'matchOwn' ? T.shoutOwnHint : T.shoutOpponentHint}</span>
      <Pips left={offer.attemptsLeft} total={offer.attemptsTotal} />
    </button>
  );
  return (
    <div className="shouts-wrap">
      {why && (
        <p className={cx('shouts__why', other !== null && 'is-claimed')} role="status">
          {why}
        </p>
      )}
      <div className={cx('shouts', !(reactions.matchOwn && reactions.matchOpponent) && 'shouts--one', why !== null && 'shouts--quiet')} role="group" aria-label="Reações">
        {reactions.matchOwn && button('matchOwn')}
        {reactions.matchOpponent && button('matchOpponent')}
      </div>
    </div>
  );
}

/**
 * What you can do right now: the guide for multi-step choices, the shouts
 * whenever a reaction window is open (even next to a power of your own), and
 * the buttons of your turn. Every action is still validated by the server.
 */
export function ActionBar({
  view,
  ctx,
  picks,
  offer = null,
  claiming = null,
  onSend,
  onShout,
  onRestart,
  reactions = ALL_REACTIONS,
}: ActionBarProps) {
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
      const total = peekManyTargets(ctx.targetCount);
      // A disabled button always says what is missing.
      const missing =
        ctx.power === 'peekOwn' || (ctx.power === 'blindSwap' && picks.own.length === 0)
          ? T.needOwn
          : many
            ? T.needOpps(Math.max(1, total - picks.opponents.length))
            : T.needOpp;
      const label = action ? (many && ctx.targetCount !== null ? `${text.confirm} (${T.pickedOf(picks.opponents.length, ctx.targetCount)})` : text.confirm) : missing;
      row = (
        <>
          <Btn primary disabled={!action} onClick={() => action && onSend(action)}>
            {label}
          </Btn>
          <Btn onClick={() => onSend({ type: 'skipPower' })}>{ctx.power === 'blindSwap' ? T.keepAsIs : T.skipPower}</Btn>
        </>
      );
      break;
    }
    case 'myPowerSwap': {
      const action = powerSwapAction(picks, ctx.peeked);
      const missing = ctx.peeked.length > 1 && picks.opponents.length === 0 ? T.needPeeked : T.needOwn;
      row = (
        <>
          <Btn primary disabled={!action} onClick={() => action && onSend(action)}>
            {action ? T.powerSwap : missing}
          </Btn>
          <Btn onClick={() => onSend({ type: 'skipPower' })}>{T.keepAsIs}</Btn>
        </>
      );
      break;
    }
    default:
      row = null;
  }

  const guide = guideFor(view, ctx, picks);
  const shouts = offer !== null && ctx.kind !== 'claim' ? (
    <Shouts view={view} offer={offer} claiming={claiming} reactions={reactions} onShout={onShout} />
  ) : null;

  if (row === null && guide === null && shouts === null) return null;

  return (
    <div className={cx('actionbar', shouts && 'actionbar--reaction', ctx.kind === 'claim' && 'actionbar--claim')} aria-label="Ações">
      {guide && <GuidePanel guide={guide} canRestart={picks.own.length + picks.opponents.length > 0} onRestart={onRestart} />}
      {shouts}
      {row && <div className="actionbar__row">{row}</div>}
    </div>
  );
}

export interface CallEndButtonProps {
  readonly view: GameView;
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
