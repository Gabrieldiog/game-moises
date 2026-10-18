import { describe, expect, it } from 'vitest';
import { ActionSchema, PROTOCOL_LIMITS, parseAction, POWER_KINDS } from '../src/index.js';

const target = { playerId: 'p2', slot: 1 };

const VALID_ACTIONS = [
  { type: 'arrange', fromSlot: 0, toSlot: 3 },
  { type: 'draw' },
  { type: 'swapWithDrawn', slot: 2 },
  { type: 'discardDrawn' },
  { type: 'callEnd' },
  { type: 'usePower', power: 'peekOwn', slot: 0 },
  { type: 'usePower', power: 'peekOpponent', target },
  { type: 'usePower', power: 'blindSwap', ownSlot: 0, target },
  { type: 'usePower', power: 'peekAndSwap', target },
  { type: 'usePower', power: 'peekManyAndSwap', targets: [target, { playerId: 'p3', slot: 0 }] },
  { type: 'powerSwap', ownSlot: 1, target },
  { type: 'skipPower' },
  { type: 'matchOwn', slot: 3 },
  { type: 'matchOpponent', target, giveSlot: 0 },
] as const;

describe('ActionSchema', () => {
  it.each(VALID_ACTIONS)('accepts $type', (action) => {
    const result = parseAction(action);
    expect(result).toEqual({ ok: true, action });
  });

  it('has a usePower variant for every power kind', () => {
    const covered = new Set(VALID_ACTIONS.filter((a) => a.type === 'usePower').map((a) => (a as { power: string }).power));
    expect([...covered].sort()).toEqual([...POWER_KINDS].sort());
  });

  it.each([null, undefined, 42, 'draw', [], {}, { type: 'fly' }, { type: 'DRAW' }, { action: 'draw' }])(
    'rejects malformed payload %j',
    (payload) => {
      const result = parseAction(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
    },
  );

  it.each(VALID_ACTIONS)('rejects $type carrying card data or unknown keys', (action) => {
    for (const extra of [
      { card: { kind: 'standard', rank: 'K', suit: 'hearts' } },
      { value: -1 },
      { rank: 'K' },
      { playerId: 'p1' },
    ]) {
      // playerId is legitimately part of nested targets, never of the action root.
      expect(ActionSchema.safeParse({ ...action, ...extra }).success).toBe(false);
    }
  });

  it('rejects a __proto__ key', () => {
    expect(parseAction(JSON.parse('{"type":"draw","__proto__":{"polluted":true}}')).ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects extra keys inside a target', () => {
    expect(parseAction({ type: 'usePower', power: 'peekOpponent', target: { ...target, card: 'KH' } }).ok).toBe(false);
  });

  describe('slot indexes', () => {
    it.each([0, 1, PROTOCOL_LIMITS.maxSlotIndex])('accepts %s', (slot) => {
      expect(parseAction({ type: 'matchOwn', slot }).ok).toBe(true);
    });

    it.each([-1, 1.5, PROTOCOL_LIMITS.maxSlotIndex + 1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, true, 2 ** 53])(
      'rejects %s',
      (slot) => {
        expect(parseAction({ type: 'matchOwn', slot }).ok).toBe(false);
        expect(parseAction({ type: 'arrange', fromSlot: slot, toSlot: 0 }).ok).toBe(false);
        expect(parseAction({ type: 'matchOpponent', target: { playerId: 'p2', slot }, giveSlot: 0 }).ok).toBe(false);
      },
    );
  });

  describe('player ids in targets', () => {
    it('accepts the longest allowed id', () => {
      const playerId = 'a'.repeat(PROTOCOL_LIMITS.playerIdMaxLength);
      expect(parseAction({ type: 'usePower', power: 'peekOpponent', target: { playerId, slot: 0 } }).ok).toBe(true);
    });

    it.each(['', 'a'.repeat(PROTOCOL_LIMITS.playerIdMaxLength + 1), 'a b', '<script>', 'p1;drop', 'é', 7, null])(
      'rejects %j',
      (playerId) => {
        expect(parseAction({ type: 'usePower', power: 'peekOpponent', target: { playerId, slot: 0 } }).ok).toBe(false);
      },
    );
  });

  describe('usePower', () => {
    it('rejects an unknown power', () => {
      expect(parseAction({ type: 'usePower', power: 'seeEverything' }).ok).toBe(false);
    });

    it('rejects a power with the fields of another power', () => {
      expect(parseAction({ type: 'usePower', power: 'peekOwn', target }).ok).toBe(false);
      expect(parseAction({ type: 'usePower', power: 'blindSwap', target }).ok).toBe(false);
    });

    it('bounds the number of targets', () => {
      expect(parseAction({ type: 'usePower', power: 'peekManyAndSwap', targets: [] }).ok).toBe(false);
      const many = Array.from({ length: PROTOCOL_LIMITS.maxPowerTargets + 1 }, (_, slot) => ({ playerId: 'p2', slot: slot % 4 }));
      expect(parseAction({ type: 'usePower', power: 'peekManyAndSwap', targets: many }).ok).toBe(false);
    });
  });

  it('never throws, even on hostile input', () => {
    const cyclic: Record<string, unknown> = { type: 'draw' };
    cyclic['self'] = cyclic;
    expect(() => parseAction(cyclic)).not.toThrow();
    expect(parseAction(cyclic).ok).toBe(false);
    expect(() => parseAction(Object.create(null))).not.toThrow();
  });
});
