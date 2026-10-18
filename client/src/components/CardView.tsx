import { cardColor, type Card, type Rank, type SlotView, type Suit } from '@moises/shared';
import backUrl from '../assets/card-back.svg';
import { cardName, SUIT_SYMBOLS, T } from '../i18n/pt-BR';
import { cx } from './cx';

export type CardSize = 'you' | 'opp' | 'pile' | 'hand' | 'end';

const FILE_RANK: Record<Rank, string> = {
  A: 'A',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': 'T',
  J: 'J',
  Q: 'Q',
  K: 'K',
};

const FILE_SUIT: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

/** File name of a face in public/cards (Adrian Kennard's CC0 set). */
export function faceFile(card: Card): string {
  if (card.kind === 'joker') return card.color === 'red' ? '1J' : '2J';
  return `${FILE_RANK[card.rank]}${FILE_SUIT[card.suit]}`;
}

export function faceUrl(card: Card): string {
  return `${import.meta.env.BASE_URL}cards/${faceFile(card)}.svg`;
}

export interface CardViewProps {
  /** What the viewer may see of this position (already expired by the caller if its time is over). */
  readonly slot: SlotView;
  readonly size: CardSize;
  /** Where the card is, for screen readers ("Sua posição 2", "Ana, posição 1", "Descarte"). */
  readonly label: string;
  readonly selectable?: boolean;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  /** Extra emphasis, e.g. the card that opened a reaction window. */
  readonly accent?: 'reaction' | null;
  readonly className?: string;
}

/**
 * One card. A hidden card renders only the generic back: no face, id or hint
 * of its value reaches the DOM or the accessibility tree.
 */
export function CardView({ slot, size, label, selectable = false, selected = false, onSelect, accent = null, className }: CardViewProps) {
  const description =
    slot.state === 'empty' ? T.emptySlot : slot.state === 'hidden' ? T.hiddenCard : cardName(slot.card);
  const ariaLabel = `${label}: ${description}`;
  const king = slot.state === 'visible' && slot.card.kind === 'standard' && slot.card.rank === 'K' ? slot.card : null;

  const classes = cx(
    'card',
    `card--${size}`,
    `card--${slot.state}`,
    selectable && 'is-selectable',
    selected && 'is-selected',
    slot.state === 'visible' && slot.until !== null && 'is-timed',
    king && `card--king-${cardColor(king)}`,
    accent && `card--${accent}`,
    className,
  );

  const content =
    slot.state === 'empty' ? null : slot.state === 'hidden' ? (
      <img className="card__img" src={backUrl} alt="" draggable={false} />
    ) : (
      <>
        <img className="card__img" src={faceUrl(slot.card)} alt="" draggable={false} />
        {king && (
          <span className="card__kfold" aria-hidden="true">
            <span className="card__kfold-suit">{SUIT_SYMBOLS[king.suit]}</span>
          </span>
        )}
      </>
    );

  if (selectable && onSelect) {
    return (
      <button type="button" className={classes} aria-label={ariaLabel} aria-pressed={selected} onClick={onSelect}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} role="img" aria-label={ariaLabel}>
      {content}
    </div>
  );
}
