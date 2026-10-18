import { createHmac, randomBytes } from 'node:crypto';

// Deterministic, seedable random numbers stored inside the game state, so the
// engine stays pure and every game can be replayed from its seed.
//
// Each number is HMAC-SHA256(seed, counter). Unlike a small PRNG such as
// mulberry32 (32-bit state), the sequence cannot be brute-forced from the
// cards a player sees, as long as the seed is secret and long. In production
// use generateSeed(); never send the seed to a client.

export interface RngState {
  readonly seed: string;
  readonly counter: number;
}

export const MIN_SEED_LENGTH = 16;
export const MAX_SEED_LENGTH = 512;

export function createRng(seed: string): RngState {
  return { seed, counter: 0 };
}

/** 256-bit seed from the OS CSPRNG. For the server; the engine itself never calls it. */
export function generateSeed(): string {
  return randomBytes(32).toString('hex');
}

function nextUint32(rng: RngState): [number, RngState] {
  const digest = createHmac('sha256', rng.seed).update(String(rng.counter)).digest();
  return [digest.readUInt32BE(0), { seed: rng.seed, counter: rng.counter + 1 }];
}

const UINT32_RANGE = 2 ** 32;

/** Uniform integer in [0, maxExclusive), without modulo bias (rejection sampling). */
export function randomInt(rng: RngState, maxExclusive: number): [number, RngState] {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`randomInt: invalid bound ${maxExclusive}`);
  }
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  let state = rng;
  for (;;) {
    const [value, next] = nextUint32(state);
    state = next;
    if (value < limit) return [value % maxExclusive, state];
  }
}

/** Fisher-Yates shuffle. Returns a new array; the input is not modified. */
export function shuffle<T>(items: readonly T[], rng: RngState): [T[], RngState] {
  const out = [...items];
  let state = rng;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = randomInt(state, i + 1);
    state = next;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return [out, state];
}
