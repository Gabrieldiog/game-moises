// Interface-only constants (refresh rates, how long a notice stays up).
// Game rules and timings are never here: they come from the server's GameView.

/** How often countdowns and timed cards re-render while something is ticking. */
export const CLOCK_TICK_MS = 100;

/** How long an error notice stays on screen. */
export const NOTICE_MS = 4_000;

/** How long a request waits for the server's answer before giving up (transport setting, not a rule). */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Bots preselected for "Jogar contra bots" (only the starting value of the
 * picker). How many fit at a table is the server's rule: the picker is capped
 * by the room size the server reported last (RoomView.settings), and the
 * server refuses anything else with ROOM_FULL.
 */
export const QUICK_PLAY_DEFAULT_BOTS = 2;
