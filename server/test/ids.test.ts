import { describe, expect, it } from 'vitest';
import { PlayerIdSchema, ROOM_CODE_ALPHABET, RoomCodeSchema, SessionTokenSchema } from '@moises/shared';
import { hashToken, newPlayerId, newRoomCode, newSessionToken } from '../src/util/ids.js';

describe('server-generated identifiers', () => {
  it('player ids pass the protocol schema and do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newPlayerId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(PlayerIdSchema.safeParse(id).success).toBe(true);
  });

  it('session tokens are 256-bit base64url and do not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, newSessionToken));
    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(SessionTokenSchema.safeParse(token).success).toBe(true);
  });

  it('stores tokens only as a hash', () => {
    const token = newSessionToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).not.toBe(hashToken(newSessionToken()));
  });

  it('room codes use the alphabet, have the requested length and pass the schema', () => {
    for (const length of [4, 6, 12]) {
      const code = newRoomCode(length);
      expect(code).toHaveLength(length);
      expect([...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(RoomCodeSchema.parse(code)).toBe(code);
    }
  });

  it('room codes are spread over the whole alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of newRoomCode(6)) seen.add(ch);
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });
});
