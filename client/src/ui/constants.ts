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

/** How much one tap on the "Tempo por decisão" stepper changes (the bounds come from PROTOCOL_LIMITS). */
export const TURN_SECONDS_STEP = 5;

/** How long each table narration (balloon, eye, flying cards) stays on screen. */
export const BEAT_MS = 1_100;
/** Two cards flying take a little longer to read. */
export const BEAT_MS_SWAP = 1_300;
/** When narrations pile up, each one is shown for this long. */
export const BEAT_MS_BUSY = 700;
/** The cards' flight when two positions swap. */
export const SWAP_FLIGHT_MS = 680;
/** Lines kept in the play history. */
export const FEED_MAX = 20;
