import { describe, expect, it } from 'vitest';
import { FailureLimiter, TokenBucket } from '../src/net/rate-limit.js';

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

describe('FailureLimiter', () => {
  it('refuses a key once it used up its failures, and only that key', () => {
    const limiter = new FailureLimiter(3, 1000);
    expect(limiter.allowed('a', 0)).toBe(true);
    limiter.fail('a', 0);
    limiter.fail('a', 10);
    expect(limiter.allowed('a', 20)).toBe(true); // 2 of 3 used
    limiter.fail('a', 20);
    expect(limiter.allowed('a', 30)).toBe(false);
    expect(limiter.allowed('b', 30)).toBe(true);
  });

  it('starts over when the window ends, and later failures do not extend it', () => {
    const limiter = new FailureLimiter(1, 1000);
    limiter.fail('a', 0);
    limiter.fail('a', 900); // inside the window: counted, window still ends at 1000
    expect(limiter.allowed('a', 999)).toBe(false);
    expect(limiter.allowed('a', 1000)).toBe(true);
    limiter.fail('a', 1000);
    expect(limiter.allowed('a', 1500)).toBe(false);
    expect(limiter.allowed('a', 2000)).toBe(true);
  });

  it('keeps memory bounded: prune drops ended windows and the map never passes maxKeys', () => {
    const limiter = new FailureLimiter(5, 1000, 3);
    limiter.fail('a', 0);
    limiter.fail('b', 100);
    limiter.fail('c', 200);
    limiter.prune(1050);
    expect(limiter.size).toBe(2); // 'a' ended; 'b' ends at 1100, 'c' at 1200
    limiter.fail('d', 1060);
    limiter.fail('e', 1070); // full and nothing ended: the oldest window ('b') makes room
    expect(limiter.size).toBe(3);
    expect(limiter.allowed('b', 1070)).toBe(true);
    for (let i = 0; i < 100; i++) limiter.fail(`k${i}`, 1080);
    expect(limiter.size).toBe(3);
  });

  it('rejects invalid settings', () => {
    expect(() => new FailureLimiter(0, 1000)).toThrow(RangeError);
    expect(() => new FailureLimiter(1, 0)).toThrow(RangeError);
    expect(() => new FailureLimiter(1, 1000, 0)).toThrow(RangeError);
  });
});
