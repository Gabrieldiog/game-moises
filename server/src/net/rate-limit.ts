/**
 * Token bucket: holds up to `capacity` tokens, refilled continuously at
 * `refillPerSecond`. Each message takes one token; with no token left the
 * message is refused. Time is passed in, so it is easy to test.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    if (!(capacity >= 1) || !(refillPerSecond > 0)) throw new RangeError('TokenBucket: invalid capacity or rate');
    this.tokens = capacity;
    this.last = now;
  }

  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Counts failed attempts per key (an address) in a fixed window. The first
 * failure opens a window of `windowMs`; once `max` failures happened inside it,
 * the key is refused until the window ends. Time is passed in, so it is easy
 * to test. Memory is bounded: entries expire with their window (`prune`) and
 * there are never more than `maxKeys` of them.
 */
export class FailureLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {
    if (!(max >= 1) || !(windowMs > 0) || !(maxKeys >= 1)) throw new RangeError('FailureLimiter: invalid settings');
  }

  /** Whether `key` may try again (it has not used up its failures in the current window). */
  allowed(key: string, now: number): boolean {
    const entry = this.entries.get(key);
    if (!entry) return true;
    if (now >= entry.resetAt) {
      this.entries.delete(key);
      return true;
    }
    return entry.count < this.max;
  }

  /** Records one failed attempt by `key`. */
  fail(key: string, now: number): void {
    const entry = this.entries.get(key);
    if (entry && now < entry.resetAt) {
      entry.count += 1;
      return;
    }
    this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      this.prune(now);
      // Still full: drop the oldest window (Map keeps insertion order).
      if (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value as string);
    }
    this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
  }

  /** Forgets windows that have ended. */
  prune(now: number): void {
    for (const [key, entry] of this.entries) if (now >= entry.resetAt) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
