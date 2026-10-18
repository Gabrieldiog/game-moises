import { useEffect, useRef } from 'react';
import { T } from '../i18n/pt-BR';
import { cx } from './cx';
import { Icon } from './Icon';
import type { FeedEntry } from './useNarration';

export interface FeedProps {
  readonly entries: readonly FeedEntry[];
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The history of the table, newest first, in plain words. A bottom sheet on
 * phones and a side panel on wide screens; it never covers the action bar
 * for long, since it closes with a tap outside, the close button or Esc.
 */
export function Feed({ entries, open, onClose }: FeedProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="feed__scrim" onClick={onClose} aria-hidden="true" />
      <section className="feed" role="dialog" aria-modal="false" aria-labelledby="feed-title">
        <header className="feed__head">
          <h2 id="feed-title" className="feed__title">
            {T.feedTitle}
          </h2>
          <button ref={closeRef} type="button" className="iconbtn" aria-label={T.feedClose} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {entries.length === 0 ? (
          <p className="feed__empty">{T.feedEmpty}</p>
        ) : (
          <ol className="feed__list" role="log">
            {entries.map((entry) => (
              <li key={entry.id} className={cx('feed__line', `feed__line--${entry.tone}`)}>
                <span className="feed__icon">
                  <Icon name={entry.icon} size={18} />
                </span>
                <span className="feed__text">{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export interface FeedButtonProps {
  readonly unseen: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}

export function FeedButton({ unseen, open, onToggle }: FeedButtonProps) {
  return (
    <button
      type="button"
      className={cx('iconbtn', 'iconbtn--felt', open && 'is-on')}
      aria-label={unseen > 0 ? `${T.feedOpen} (${T.feedNew(unseen)})` : T.feedOpen}
      aria-expanded={open}
      onClick={onToggle}
    >
      <Icon name="history" />
      {unseen > 0 && (
        <span className="iconbtn__badge" aria-hidden="true">
          {unseen > 9 ? '9+' : unseen}
        </span>
      )}
    </button>
  );
}
