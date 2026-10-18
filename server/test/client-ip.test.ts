import { describe, expect, it } from 'vitest';
import { clientIp } from '../src/net/server.js';

describe('clientIp', () => {
  it('uses the TCP peer when no proxy is trusted, ignoring X-Forwarded-For', () => {
    expect(clientIp('203.0.113.9', '1.2.3.4', 0)).toBe('203.0.113.9');
  });

  it('strips the IPv4-mapped IPv6 prefix', () => {
    expect(clientIp('::ffff:127.0.0.1', undefined, 0)).toBe('127.0.0.1');
  });

  it('with N trusted proxies takes the N-th address from the right', () => {
    // client -> CDN -> load balancer -> server; the client may forge the leftmost entries.
    expect(clientIp('10.0.0.2', 'forged, 198.51.100.7', 1)).toBe('198.51.100.7');
    expect(clientIp('10.0.0.2', 'forged, 198.51.100.7, 10.0.0.1', 2)).toBe('198.51.100.7');
    expect(clientIp('10.0.0.2', ['forged', '198.51.100.7'], 1)).toBe('198.51.100.7');
  });

  it('falls back to the peer when the header is missing, short or absurd', () => {
    expect(clientIp('10.0.0.2', undefined, 1)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', '198.51.100.7', 2)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', 'x'.repeat(200), 1)).toBe('10.0.0.2');
    expect(clientIp(undefined, undefined, 0)).toBe('unknown');
  });
});
