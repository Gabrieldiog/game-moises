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

  it('keys IPv6 clients by their /64, so rotating inside it does not escape per-address limits', () => {
    const key = '2001:db8:abcd:12::/64';
    expect(clientIp('2001:db8:abcd:12::1', undefined, 0)).toBe(key);
    expect(clientIp('2001:db8:abcd:12:ffff:eeee:dddd:cccc', undefined, 0)).toBe(key);
    expect(clientIp('2001:0DB8:ABCD:0012:0:0:0:5', undefined, 0)).toBe(key);
    expect(clientIp('2001:db8:abcd:13::1', undefined, 0)).not.toBe(key);
    expect(clientIp('10.0.0.2', '2001:db8:abcd:12::9', 1)).toBe(key);
  });

  it('handles compressed, loopback and zone-id IPv6 forms; IPv4 stays as is', () => {
    expect(clientIp('2001:db8::1', undefined, 0)).toBe('2001:db8:0:0::/64');
    expect(clientIp('::1', undefined, 0)).toBe('0:0:0:0::/64');
    expect(clientIp('fe80::1%eth0', undefined, 0)).toBe('fe80:0:0:0::/64');
    expect(clientIp('203.0.113.9', undefined, 0)).toBe('203.0.113.9');
  });

  it('returns what it cannot parse unchanged instead of guessing', () => {
    expect(clientIp('not:an:ip', undefined, 0)).toBe('not:an:ip');
    expect(clientIp('zzzz:1:2:3:4:5:6:7', undefined, 0)).toBe('zzzz:1:2:3:4:5:6:7');
  });

  it('falls back to the peer when the header is missing, short or absurd', () => {
    expect(clientIp('10.0.0.2', undefined, 1)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', '198.51.100.7', 2)).toBe('10.0.0.2');
    expect(clientIp('10.0.0.2', 'x'.repeat(200), 1)).toBe('10.0.0.2');
    expect(clientIp(undefined, undefined, 0)).toBe('unknown');
  });
});
