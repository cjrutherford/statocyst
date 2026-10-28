import {
  assertSecureBaseUrl,
  normalizeBaseUrl,
} from './jellyfin-client';

export type EndpointScope = 'lan' | 'vpn' | 'wan';

export interface EndpointCandidate {
  /** Base URL, with or without a trailing slash. */
  url: string;
  scope: EndpointScope;
}

export interface RejectedEndpoint {
  url: string;
  reason: 'INVALID' | 'INSECURE' | 'DUPLICATE';
  message: string;
}

export interface EndpointSelection {
  url: string;
  scope: EndpointScope;
  rejected: RejectedEndpoint[];
}

export interface SelectEndpointOptions {
  /** Plain HTTP is only permitted for loopback fixtures (default true). */
  allowInsecureLoopback?: boolean;
  /** Priority order for scopes; defaults to LAN → VPN → WAN. */
  scopePriority?: readonly EndpointScope[];
}

const DEFAULT_PRIORITY: readonly EndpointScope[] = ['lan', 'vpn', 'wan'];

/**
 * Orders endpoint candidates by validation and reachability class (ADR-004).
 *
 * Invariant: an HTTPS endpoint is never replaced by a plain-HTTP alternative,
 * even when the insecure alternative is listed first. Non-loopback HTTP
 * candidates are rejected outright rather than silently downgraded.
 */
export function rankEndpoints(
  candidates: readonly EndpointCandidate[],
  options: SelectEndpointOptions = {},
): { ranked: Array<{ url: string; scope: EndpointScope }>; rejected: RejectedEndpoint[] } {
  const allowInsecureLoopback = options.allowInsecureLoopback ?? true;
  const priority = options.scopePriority ?? DEFAULT_PRIORITY;
  const rejected: RejectedEndpoint[] = [];
  const seen = new Set<string>();
  const ranked: Array<{ url: string; scope: EndpointScope; order: number }> = [];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate.url);
    if (!normalized) {
      rejected.push({ url: candidate.url, reason: 'INVALID', message: 'The endpoint URL is not valid' });
      continue;
    }
    const insecure = assertSecureBaseUrl(normalized, allowInsecureLoopback);
    if (insecure) {
      rejected.push({
        url: normalized,
        reason: 'INSECURE',
        message: insecure.message,
      });
      continue;
    }
    if (seen.has(normalized)) {
      rejected.push({
        url: normalized,
        reason: 'DUPLICATE',
        message: 'The endpoint is listed more than once',
      });
      continue;
    }
    seen.add(normalized);
    const order = priority.indexOf(candidate.scope);
    ranked.push({ url: normalized, scope: candidate.scope, order: order === -1 ? priority.length : order });
  }

  ranked.sort((a, b) => a.order - b.order);
  return { ranked: ranked.map(({ url, scope }) => ({ url, scope })), rejected };
}

/**
 * Selects the best validated endpoint, or null when none is usable. Never
 * falls back from HTTPS to HTTP.
 */
export function selectEndpoint(
  candidates: readonly EndpointCandidate[],
  options: SelectEndpointOptions = {},
): EndpointSelection | null {
  const { ranked, rejected } = rankEndpoints(candidates, options);
  const first = ranked[0];
  if (!first) return null;
  return { url: first.url, scope: first.scope, rejected };
}

/**
 * Returns the next alternative after `current` failed, skipping any endpoint
 * that would downgrade transport security.
 */
export function nextEndpoint(
  current: string,
  candidates: readonly EndpointCandidate[],
  options: SelectEndpointOptions = {},
): EndpointSelection | null {
  const normalizedCurrent = normalizeBaseUrl(current);
  const { ranked, rejected } = rankEndpoints(candidates, options);
  const index = ranked.findIndex((candidate) => candidate.url === normalizedCurrent);
  const next = ranked[index + 1] ?? null;
  if (!next) return null;
  return { url: next.url, scope: next.scope, rejected };
}
