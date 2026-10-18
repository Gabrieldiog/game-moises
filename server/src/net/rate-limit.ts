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
