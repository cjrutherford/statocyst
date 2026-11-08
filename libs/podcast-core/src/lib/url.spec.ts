import { describe, expect, it } from 'vitest';
import {
  checkHttpUrl,
  isAlwaysBlockedAddress,
  isPrivateAddress,
  normalizeFeedUrl,
  redactUrlForLog,
} from '../index';

describe('URL safety', () => {
  it('accepts public HTTP(S) URLs and rejects credentials/schemes', () => {
    expect(checkHttpUrl('https://example.com/feed.xml').ok).toBe(true);
    expect(checkHttpUrl('http://example.com/feed.xml').ok).toBe(true);
    expect(checkHttpUrl('ftp://example.com/feed.xml')).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_SCHEME',
    });
    expect(checkHttpUrl('https://user:pass@example.com/feed.xml')).toMatchObject({
      ok: false,
      code: 'CREDENTIALS',
    });
    expect(checkHttpUrl('not a url')).toMatchObject({ ok: false, code: 'INVALID_URL' });
  });

  it('blocks private, loopback, link-local and metadata addresses by default', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.5',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:192.168.1.1',
      'localhost',
      'printer.local',
    ]) {
      expect(isPrivateAddress(address) || /local|^localhost$/i.test(address), address).toBe(true);
      const result = checkHttpUrl(`http://${address}/feed`);
      expect(result.ok, address).toBe(false);
    }
  });

  it('allows private/loopback feeds only when local networking is enabled', () => {
    expect(checkHttpUrl('http://192.168.1.5/feed', { allowLocalNetwork: true }).ok).toBe(true);
    expect(checkHttpUrl('http://127.0.0.1:8080/feed', { allowLocalNetwork: true }).ok).toBe(true);
    expect(checkHttpUrl('http://[::1]/feed', { allowLocalNetwork: true }).ok).toBe(true);
    expect(checkHttpUrl('http://169.254.169.254/latest', { allowLocalNetwork: true }).ok).toBe(
      false,
    );
    expect(checkHttpUrl('http://[::ffff:169.254.169.254]/', { allowLocalNetwork: true }).ok).toBe(
      false,
    );
    expect(isAlwaysBlockedAddress('169.254.169.254')).toBe(true);
    expect(isAlwaysBlockedAddress('fe80::1')).toBe(true);
    expect(isAlwaysBlockedAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('normalizes feed identity and redacts logs', () => {
    expect(normalizeFeedUrl('HTTPS://Feeds.Example.com:443/a/../feed.xml#frag')).toBe(
      'https://feeds.example.com/feed.xml',
    );
    expect(normalizeFeedUrl('http://example.com:80/feed.xml')).toBe('http://example.com/feed.xml');
    expect(normalizeFeedUrl('javascript:alert(1)')).toBeNull();
    expect(redactUrlForLog('https://example.com/private?token=secret')).toBe(
      'https://example.com/…',
    );
  });
});
