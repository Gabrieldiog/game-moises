import { RANKS, type Rank } from '@moises/shared';

// Which ranks CAN have a power is a server rule. The protocol only sends the
// ranks whose power is ON at this table (RoomView.table.powers), and a new
// room starts with every power on. So the list of switches is the union of
// every rank this tab has seen on for the room, kept per tab
// (sessionStorage) so a reload does not lose a rank the host switched off.
// The server still refuses (BAD_REQUEST) any rank without a power.

const KEY = 'moises.poderes';

export interface RankMemory {
  load(): { readonly code: string; readonly ranks: readonly string[] } | null;
  save(value: { readonly code: string; readonly ranks: readonly Rank[] }): void;
}

export function sessionRankMemory(): RankMemory {
  return {
    load() {
      try {
        const raw = window.sessionStorage.getItem(KEY);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { code, ranks } = parsed as { code?: unknown; ranks?: unknown };
        if (typeof code !== 'string' || !Array.isArray(ranks)) return null;
        return { code, ranks: ranks.filter((r): r is string => typeof r === 'string') };
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        // Only a convenience.
      }
    },
  };
}

/** Ranks to offer as power switches for room `code`, in rank order. */
export function knownPowerRanks(code: string, current: readonly Rank[], memory: RankMemory = sessionRankMemory()): Rank[] {
  const saved = memory.load();
  const seen = new Set<string>(saved?.code === code ? saved.ranks : []);
  for (const rank of current) seen.add(rank);
  const ranks = RANKS.filter((rank) => seen.has(rank));
  if (saved?.code !== code || ranks.length !== saved.ranks.length) memory.save({ code, ranks });
  return ranks;
}
