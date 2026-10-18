// Interface-only constants (refresh rates, how long a notice stays up).
// Game rules and timings are never here: they come from the server's GameView.

/** How often countdowns and timed cards re-render while something is ticking. */
export const CLOCK_TICK_MS = 100;

/** How long an error notice stays on screen. */
export const NOTICE_MS = 4_000;
