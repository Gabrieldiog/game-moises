import type { PlayerView } from '@moises/shared';
import { effectiveSlot } from '../game/selectors';
import { CardView, type CardSize } from './CardView';
import { cx } from './cx';

export interface GridProps {
  readonly player: PlayerView;
  /** Server time, to turn timed cards face down when their time is over. */
  readonly now: number;
  readonly size: CardSize;
  readonly label: string;
  readonly slotLabel: (slot: number) => string;
  readonly isSelectable?: (slot: number) => boolean;
  readonly isSelected?: (slot: number) => boolean;
  readonly onSelect?: (slot: number) => void;
  /** Show 1-based position numbers under the cards (your own grid). */
  readonly numbered?: boolean;
  /** Anchor prefix for animations: cell n is announced as `${prefix}${n}`. */
  readonly anchorPrefix?: string;
  readonly className?: string;
}

/** A player's positions, two per row: [0][1] / [2][3] / ... Empty positions keep their place. */
export function Grid({ player, now, size, label, slotLabel, isSelectable, isSelected, onSelect, numbered = false, anchorPrefix, className }: GridProps) {
  return (
    <div className={cx('grid', `grid--${size}`, className)} role="group" aria-label={label}>
      {player.slots.map((raw, slot) => {
        const selectable = isSelectable?.(slot) ?? false;
        return (
          // Positions are stable, so the index is the identity of a cell.
          <div className="grid__cell" key={slot}>
            <CardView
              slot={effectiveSlot(raw, now)}
              size={size}
              label={slotLabel(slot)}
              {...(anchorPrefix ? { anchor: `${anchorPrefix}${slot}` } : {})}
              selectable={selectable}
              selected={isSelected?.(slot) ?? false}
              {...(selectable && onSelect ? { onSelect: () => onSelect(slot) } : {})}
            />
            {numbered && (
              <span className="grid__num" aria-hidden="true">
                {slot + 1}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
