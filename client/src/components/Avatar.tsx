import { avatarLook, type AvatarLook } from '../game/avatars';
import { T } from '../i18n/pt-BR';
import { cx } from './cx';

export interface AvatarProps {
  readonly name: string;
  /** Player id: the color and shape come from it, the same everywhere. */
  readonly id: string;
  /** Look resolved for the whole table (avoids two players sharing a color); derived from the id alone when omitted. */
  readonly look?: AvatarLook | undefined;
  readonly isBot?: boolean;
  readonly className?: string;
}

/** Token with the first letter of the name. Purely visual; the name is read next to it. */
export function Avatar({ name, id, look, isBot = false, className }: AvatarProps) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  const { color, shape } = look ?? avatarLook(id);
  return (
    <span className={cx('avatar', `avatar--c${color}`, `avatar--s${shape}`, isBot && 'is-bot', className)} aria-hidden="true">
      {initial}
      {isBot && <span className="avatar__bot" title={T.bot} />}
    </span>
  );
}
