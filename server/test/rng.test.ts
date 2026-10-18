import { describe, expect, it } from 'vitest';
import { createRng, generateSeed, randomInt, shuffle } from '../src/engine/rng.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = shuffle([...Array(54).keys()], createRng('seed-aaaaaaaaaaaaaaaa'));
    const b = shuffle([...Array(54).keys()], createRng('seed-aaaaaaaaaaaaaaaa'));
    expect(a).toEqual(b);
  });

  it('differs between seeds', () => {
    const [a] = shuffle([...Array(54).keys()], createRng('seed-aaaaaaaaaaaaaaaa'));
    const [b] = shuffle([...Array(54).keys()], createRng('seed-bbbbbbbbbbbbbbbb'));
    expect(a).not.toEqual(b);
  });

  it('shuffle returns a permutation and leaves the input alone', () => {
    const input = Object.freeze([...Array(54).keys()]);
    const [out, next] = shuffle(input, createRng('seed-cccccccccccccccc'));
    expect([...out].sort((x, y) => x - y)).toEqual([...input]);
    expect(out).not.toEqual([...input]);
    expect(next.counter).toBeGreaterThan(0);
  });

  it('randomInt stays in range and is roughly uniform', () => {
    let rng = createRng('seed-dddddddddddddddd');
    const buckets = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      let value: number;
      [value, rng] = randomInt(rng, 6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      buckets[value] = (buckets[value] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });

  it('rejects invalid bounds', () => {
    expect(() => randomInt(createRng('x'.repeat(16)), 0)).toThrow(RangeError);
    expect(() => randomInt(createRng('x'.repeat(16)), 1.5)).toThrow(RangeError);
  });

  it('generateSeed gives 256 random bits as hex', () => {
    const a = generateSeed();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSeed()).not.toBe(a);
  });
});
