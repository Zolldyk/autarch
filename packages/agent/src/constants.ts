/** Default agent decision cycle interval: 60 seconds. */
export const DEFAULT_INTERVAL_MS = 60_000;

/** Maximum consecutive errors before auto-stopping an agent. */
export const MAX_CONSECUTIVE_ERRORS = 5;

/** File watcher debounce delay for macOS atomic saves. */
export const DEBOUNCE_MS = 300;

/** Minimum allowed interval for agent decision cycles (1 second). */
export const MIN_INTERVAL_MS = 1_000;

/** Default baseline price for simulated market data ($100 USD). */
export const DEFAULT_BASELINE_PRICE = 100;

/** Default volatility for random walk (2% per tick). */
export const DEFAULT_VOLATILITY = 0.02;

/** Maximum number of ticks stored in the history ring buffer. */
export const MAX_HISTORY_SIZE = 100;

/** Minimum allowed price to prevent zero/negative prices. */
export const MIN_PRICE = 0.01;

/** Maximum allowed price to prevent runaway drift. */
export const MAX_PRICE = 10_000;

/** Default simulated volume baseline. */
export const DEFAULT_BASE_VOLUME = 1_000;

/** Minimum weighted score (0-100) required to execute an action. */
export const DEFAULT_EXECUTION_THRESHOLD = 70;

/** Maximum number of decision traces retained in the in-memory ring buffer. */
export const MAX_TRACE_HISTORY = 50;
