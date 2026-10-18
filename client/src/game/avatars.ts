// Avatar looks derived from the player id, so they are the same on every
// screen and every device. Purely visual: nothing here is a game rule.

export const AVATAR_COLORS = 12;
export const AVATAR_SHAPES = 4;

export interface AvatarLook {
  readonly color: number;
  readonly shape: number;
}

/** FNV-1a: small, stable and good enough to spread ids over a dozen colors. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Looks for everyone at one table. Each id starts at its own hashed color;
 * when two players land on the same one, the later (in the given order) moves
 * to the next free color, so nobody looks like a twin. Same ids in the same
 * order always give the same result.
 */
export function avatarLooks(ids: readonly string[]): ReadonlyMap<string, AvatarLook> {
  const used = new Set<number>();
  const looks = new Map<string, AvatarLook>();
  for (const id of ids) {
    const h = hashId(id);
    let color = h % AVATAR_COLORS;
    for (let tries = 0; tries < AVATAR_COLORS && used.has(color); tries++) color = (color + 1) % AVATAR_COLORS;
    used.add(color);
    looks.set(id, { color, shape: (h >>> 8) % AVATAR_SHAPES });
  }
  return looks;
}

/** Look for a single id when there is no table context. */
export function avatarLook(id: string): AvatarLook {
  const h = hashId(id);
  return { color: h % AVATAR_COLORS, shape: (h >>> 8) % AVATAR_SHAPES };
}
