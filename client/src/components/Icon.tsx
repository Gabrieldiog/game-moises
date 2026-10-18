import type { FeedIcon } from '../game/narrate';

export type IconName = FeedIcon | 'history' | 'sound' | 'mute' | 'close' | 'check';

// Small line icons (24px grid, stroke = currentColor). Decorative: the text next to them says the same.
const PATHS: Record<IconName, string> = {
  turn: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  draw: 'M7 3h8l2 2v12H7zM12 21v-6M9 18l3 3 3-3',
  discard: 'M7 4h10v14H7zM4 21h16M12 8v6',
  keep: 'M5 5h8v12H5zM16 8l3 3-3 3M11 11h8',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  swap: 'M4 8h14l-3-3M20 16H6l3 3',
  shout: 'M4 10v4h3l6 4V6L7 10H4ZM17 8c1.5 1 1.5 7 0 8M20 5c3 3 3 11 0 14',
  hit: 'M5 12.5 10 17l9-10',
  miss: 'M6 6l12 12M18 6 6 18',
  power: 'M13 2 5 14h6l-1 8 8-12h-6l1-8Z',
  skip: 'M5 5l8 7-8 7zM16 5v14',
  end: 'M5 21V4h11l-2 4 2 4H5',
  clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM12 8v4l3 2',
  deck: 'M6 6h10v14H6zM9 3h10v14',
  history: 'M4 6h16M4 12h16M4 18h10',
  sound: 'M4 10v4h3l6 4V6L7 10H4ZM17 9c1 1 1 5 0 6M19.5 6.5c2.5 2.5 2.5 8.5 0 11',
  mute: 'M4 10v4h3l6 4V6L7 10H4ZM17 9l5 6M22 9l-5 6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17l9-10',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
