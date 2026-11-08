export type UrlSafetyCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'CREDENTIALS'
  | 'PRIVATE_ADDRESS'
  | 'BLOCKED_HOST';

export interface UrlSafetyOptions {
  /** Permit RFC1918/ULA/loopback hosts for self-hosted feeds. */
  allowLocalNetwork?: boolean;
}

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; code: UrlSafetyCode; message: string };

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIpv6(address: string): string[] | null {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized.includes(':')) return null;
  // IPv4-mapped form: ::ffff:192.168.1.1
  const mapped = normalized.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    const octets = parseIpv4(mapped[2]);
    if (!octets) return null;
    return [
      '0',
      '0',
      '0',
      '0',
      '0',
      'ffff',
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ];
  }
  return expandIpv6(normalized);
}

function expandIpv6(address: string): string[] | null {
  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail ? tail.split(':').filter(Boolean) : [];
  if (!address.includes('::') && headGroups.length !== 8) return null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;
  return groups.map((group) => {
    const value = Number.parseInt(group || '0', 16);
    return Number.isNaN(value) || value < 0 || value > 0xffff ? 'invalid' : value.toString(16);
  });
}

function isPrivateIpv6(groups: readonly string[]): boolean {
  if (groups.some((group) => group === 'invalid')) return true;
  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  const allZero = groups.every((group) => Number.parseInt(group, 16) === 0);
  const loopback =
    groups.slice(0, 7).every((group) => Number.parseInt(group, 16) === 0) &&
    Number.parseInt(groups[7], 16) === 1;
  if (allZero || loopback) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  // IPv4-mapped ::ffff:0:0/96
  if (groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0)) {
    if (groups[5] === 'ffff') {
      const high = Number.parseInt(groups[6], 16);
      const low = Number.parseInt(groups[7], 16);
      return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    }
  }
  return false;
}

/** True for loopback/private/link-local/metadata/multicast/reserved addresses. */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isPrivateIpv4(ipv4);
  const ipv6 = parseIpv6(address);
  if (ipv6) return isPrivateIpv6(ipv6);
  return false;
}

/** Addresses that stay blocked even when local-network feeds are enabled. */
export function isAlwaysBlockedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b] = ipv4;
    return a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const ipv6 = parseIpv6(address);
  if (!ipv6) return false;
  const first = Number.parseInt(ipv6[0], 16);
  if (ipv6.every((group) => Number.parseInt(group, 16) === 0)) return true;
  if ((first & 0xffc0) === 0xfe80) return true; // link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (ipv6[5] === 'ffff') {
    const high = Number.parseInt(ipv6[6], 16);
    const low = Number.parseInt(ipv6[7], 16);
    return isAlwaysBlockedAddress(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'),
    );
  }
  return false;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa')
  );
}

/**
 * Validate a URL before a host fetches it. DNS resolution of hostnames is the
 * host adapter's job; this catches schemes, embedded credentials, IP literals
 * and obviously local hostnames.
 */
export function checkHttpUrl(value: string, options: UrlSafetyOptions = {}): UrlSafetyResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, code: 'INVALID_URL', message: 'A URL is required' };
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'The URL is not valid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'UNSUPPORTED_SCHEME', message: 'Only HTTP(S) URLs are allowed' };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'CREDENTIALS', message: 'URLs with embedded credentials are not allowed' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!options.allowLocalNetwork) {
    if (isLocalHostname(hostname)) {
      return {
        ok: false,
        code: 'BLOCKED_HOST',
        message: 'Local network hosts are disabled in settings',
      };
    }
    if (isPrivateAddress(hostname)) {
      return {
        ok: false,
        code: 'PRIVATE_ADDRESS',
        message: 'Private, loopback and link-local addresses are not allowed',
      };
    }
  } else if (isPrivateAddress(hostname)) {
    if (isAlwaysBlockedAddress(hostname)) {
      return {
        ok: false,
        code: 'PRIVATE_ADDRESS',
        message: 'Link-local, metadata and unspecified addresses are never allowed',
      };
    }
  }
  return { ok: true, url };
}

/** Resolve a possibly-relative link, allowing only HTTP(S) and no credentials. */
export function resolveHttpUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Normalize a feed URL for identity and dedupe. */
export function normalizeFeedUrl(value: string, options: UrlSafetyOptions = {}): string | null {
  const checked = checkHttpUrl(value, options);
  if (!checked.ok) return null;
  const url = checked.url;
  url.hash = '';
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  return url.toString();
}

/** Hostname-only redaction for logs. Never logs path/query tokens. */
export function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '[invalid-url]';
  }
}
