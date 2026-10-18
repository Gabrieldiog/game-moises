import { describe, expect, it } from 'vitest';
import {
  CLIENT_EVENT_NAMES,
  CreateRoomPayloadSchema,
  EmptyPayloadSchema,
  JoinRoomPayloadSchema,
  PlayerNameInputSchema,
  PROTOCOL_LIMITS,
  QuickPlayPayloadSchema,
  RemoveBotPayloadSchema,
  ResumeSessionPayloadSchema,
  ROOM_CODE_ALPHABET,
  RoomCodeSchema,
  SessionTokenSchema,
  sanitizePlayerName,
  type ClientEventName,
} from '../src/index.js';

describe('sanitizePlayerName', () => {
  it.each([
    ['  Ana  ', 'Ana'],
    ['Ana\u0000\u0007Maria', 'AnaMaria'],
    ['Ana\u202EairaM', 'AnaairaM'], // bidi override removed
    ['Jo\u200Bão', 'João'], // zero-width space removed
    ['Ana \n\t Maria', 'Ana Maria'],
    ['\uFF21\uFF22\uFF23', 'ABC'], // NFKC: fullwidth letters
    ['e\u0301\u0301\u0301\u0301', '\u00e9\u0301\u0301'], // NFKC composes the first mark; the flood is capped at two
    ['<b>Zé</b>', '<b>Zé</b>'], // plain text: not escaped here, the client renders it as text
  ])('%j -> %j', (raw, expected) => {
    expect(sanitizePlayerName(raw)).toBe(expected);
  });
});

describe('PlayerNameInputSchema', () => {
  it('returns the sanitized name', () => {
    expect(PlayerNameInputSchema.parse('  Moisés\u200B ')).toBe('Moisés');
  });

  it.each(['', '   ', '\u200B\u200B', 'x'.repeat(PROTOCOL_LIMITS.playerNameMaxLength + 1), 'x'.repeat(500), 42, null])(
    'rejects %j',
    (raw) => {
      expect(PlayerNameInputSchema.safeParse(raw).success).toBe(false);
    },
  );

  it('accepts the maximum length', () => {
    expect(PlayerNameInputSchema.safeParse('x'.repeat(PROTOCOL_LIMITS.playerNameMaxLength)).success).toBe(true);
  });
});

describe('RoomCodeSchema', () => {
  it('normalizes what a person types', () => {
    expect(RoomCodeSchema.parse('  ab3k9z ')).toBe('AB3K9Z');
  });

  it.each(['AB0K9Z', 'ABIK9Z', 'ABC', 'A'.repeat(13), 'ABC-12', '', 123])('rejects %j', (raw) => {
    expect(RoomCodeSchema.safeParse(raw).success).toBe(false);
  });

  it('uses an alphabet without look-alike characters', () => {
    for (const ch of '01ILO') expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(false);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

describe('payload schemas', () => {
  const token = 'a'.repeat(43);

  it('accept valid payloads', () => {
    expect(CreateRoomPayloadSchema.parse({ name: 'Ana' })).toEqual({ name: 'Ana' });
    expect(JoinRoomPayloadSchema.parse({ code: 'abcdef', name: 'Ana' })).toEqual({ code: 'ABCDEF', name: 'Ana' });
    expect(QuickPlayPayloadSchema.parse({ name: 'Ana', bots: 3 })).toEqual({ name: 'Ana', bots: 3 });
    expect(ResumeSessionPayloadSchema.parse({ token })).toEqual({ token });
    expect(RemoveBotPayloadSchema.parse({ playerId: 'abc_123-X' })).toEqual({ playerId: 'abc_123-X' });
    expect(EmptyPayloadSchema.parse({})).toEqual({});
    expect(EmptyPayloadSchema.parse(undefined)).toBeUndefined();
  });

  it.each([
    [CreateRoomPayloadSchema, { name: 'Ana', playerId: 'p1' }],
    [CreateRoomPayloadSchema, {}],
    [CreateRoomPayloadSchema, 'Ana'],
    [JoinRoomPayloadSchema, { code: 'ABCDEF' }],
    [QuickPlayPayloadSchema, { name: 'Ana', bots: 0 }],
    [QuickPlayPayloadSchema, { name: 'Ana', bots: 2.5 }],
    [QuickPlayPayloadSchema, { name: 'Ana', bots: PROTOCOL_LIMITS.maxBotsPerRequest + 1 }],
    [ResumeSessionPayloadSchema, { token: 'short' }],
    [ResumeSessionPayloadSchema, { token: `${token}!` }],
    [RemoveBotPayloadSchema, { playerId: '../etc' }],
    [RemoveBotPayloadSchema, { playerId: '__proto__', extra: 1 }],
    [EmptyPayloadSchema, { anything: true }],
    [EmptyPayloadSchema, null],
  ] as const)('reject malformed payload %#', (schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(false);
  });

  it('session tokens are 43 base64url characters', () => {
    expect(SessionTokenSchema.safeParse('A-_'.repeat(14) + 'z').success).toBe(true);
    expect(SessionTokenSchema.safeParse('a'.repeat(44)).success).toBe(false);
  });
});

describe('CLIENT_EVENT_NAMES', () => {
  it('lists every client event exactly once', () => {
    // Compile-time: every name is a key of ClientToServerEvents (satisfies in protocol.ts);
    // run-time: no duplicates, and the list is complete.
    const all: Record<ClientEventName, true> = {
      'room:create': true,
      'room:join': true,
      'room:quickPlay': true,
      'session:resume': true,
      'room:leave': true,
      'room:addBot': true,
      'room:removeBot': true,
      'room:start': true,
      'game:action': true,
    };
    expect([...CLIENT_EVENT_NAMES].sort()).toEqual(Object.keys(all).sort());
  });
});
