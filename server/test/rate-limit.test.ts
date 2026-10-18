import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../src/net/rate-limit.js';

describe('TokenBucket', () => {
  it('allows a burst, then refuses', () => {
    const bucket = new TokenBucket(3, 1, 0);
    expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills over time, up to the capacity', () => {
    const bucket = new TokenBucket(2, 2, 0);
    bucket.take(0);
    bucket.take(0);
    expect(bucket.take(100)).toBe(false); // 0.2 token
    expect(bucket.take(500)).toBe(true); // 1 token
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(10_000)).toBe(false); // capped at 2
  });

  it('ignores a clock going backwards', () => {
    const bucket = new TokenBucket(1, 1, 1000);
    expect(bucket.take(1000)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(1500)).toBe(false);
    expect(bucket.take(2000)).toBe(true);
  });

  it('rejects invalid settings', () => {
    expect(() => new TokenBucket(0, 1, 0)).toThrow(RangeError);
    expect(() => new TokenBucket(1, 0, 0)).toThrow(RangeError);
  });
});
