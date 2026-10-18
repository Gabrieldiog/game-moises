import { useEffect } from 'react';
import type { ConnectionNotice } from '../connection/store';
import { ROOM_CLOSED_TEXT, errorText, T } from '../i18n/pt-BR';
import { NOTICE_MS } from '../ui/constants';

export interface NoticeProps {
  readonly notice: ConnectionNotice | null;
  readonly onDismiss: (id: number) => void;
}

/** Server refusals and connection problems, in plain Portuguese. */
export function Notice({ notice, onDismiss }: NoticeProps) {
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => onDismiss(notice.id), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const { content } = notice;
  const text =
    content.kind === 'error'
      ? errorText(content.error)
      : content.kind === 'roomClosed'
        ? ROOM_CLOSED_TEXT[content.reason]
        : T.sessionLost;
  return (
    <div className="notice" role="alert">
      <span>{text}</span>
      <button type="button" className="notice__close" aria-label={T.dismiss} onClick={() => onDismiss(notice.id)}>
        ×
      </button>
    </div>
  );
}
