import { T } from '../i18n/pt-BR';
import { cx } from './cx';

export interface AvatarProps {
  readonly name: string;
  /** Seat position: picks one of the avatar colors (tokens --avatar-0..5). */
  readonly index: number;
  readonly isBot?: boolean;
  readonly className?: string;
}

/** Round token with the first letter of the name. Purely visual; the name is read next to it. */
export function Avatar({ name, index, isBot = false, className }: AvatarProps) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className={cx('avatar', `avatar--${((index % 6) + 6) % 6}`, isBot && 'is-bot', className)} aria-hidden="true">
      {initial}
      {isBot && <span className="avatar__bot" title={T.bot} />}
    </span>
  );
}
