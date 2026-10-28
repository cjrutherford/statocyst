import { describe, expect, it } from 'vitest';
import { nextEndpoint, rankEndpoints, selectEndpoint } from './endpoints';

describe('endpoint resilience', () => {
  it('prefers the LAN endpoint over VPN and WAN', () => {
    const selection = selectEndpoint([
      { url: 'https://music.example.com', scope: 'wan' },
      { url: 'https://vpn.example.com', scope: 'vpn' },
      { url: 'https://192.168.1.10:8096', scope: 'lan' },
    ]);
    expect(selection?.url).toBe('https://192.168.1.10:8096');
    expect(selection?.scope).toBe('lan');
  });

  it('never downgrades HTTPS to a plain-HTTP alternative', () => {
    const selection = selectEndpoint(
      [
        { url: 'http://music.example.com', scope: 'lan' },
        { url: 'https://music.example.com', scope: 'wan' },
      ],
      { allowInsecureLoopback: false },
    );
    expect(selection?.url).toBe('https://music.example.com');
    expect(selection?.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'http://music.example.com', reason: 'INSECURE' }),
      ]),
    );
  });

  it('returns null when every candidate is insecure', () => {
    const selection = selectEndpoint(
      [{ url: 'http://music.example.com', scope: 'wan' }],
      { allowInsecureLoopback: false },
    );
    expect(selection).toBeNull();
  });

  it('permits loopback HTTP and normalizes trailing slashes', () => {
    const selection = selectEndpoint([{ url: 'http://127.0.0.1:8096/', scope: 'lan' }]);
    expect(selection?.url).toBe('http://127.0.0.1:8096');
  });

  it('deduplicates candidates and reports them', () => {
    const { ranked, rejected } = rankEndpoints([
      { url: 'https://music.example.com', scope: 'wan' },
      { url: 'https://music.example.com/', scope: 'wan' },
    ]);
    expect(ranked).toHaveLength(1);
    expect(rejected).toEqual([
      expect.objectContaining({ reason: 'DUPLICATE' }),
    ]);
  });

  it('falls forward to the next secured alternative after a failure', () => {
    const candidates = [
      { url: 'https://192.168.1.10:8096', scope: 'lan' as const },
      { url: 'https://vpn.example.com', scope: 'vpn' as const },
      { url: 'https://music.example.com', scope: 'wan' as const },
    ];
    const next = nextEndpoint('https://192.168.1.10:8096', candidates);
    expect(next?.url).toBe('https://vpn.example.com');
  });
});
