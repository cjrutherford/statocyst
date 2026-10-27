export interface ByteRange {
  start: number;
  end: number;
}

export type RangeParse =
  | { kind: 'none' }
  | { kind: 'range'; range: ByteRange }
  | { kind: 'invalid' };

/**
 * Parses a single HTTP `Range` header against a known resource size.
 * Multi-range requests and non-byte units are rejected so the caller can
 * answer with `416` instead of guessing. Ranges are inclusive.
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number,
): RangeParse {
  if (!header) return { kind: 'none' };
  const value = header.trim();
  if (value.length === 0) return { kind: 'none' };
  if (!value.toLowerCase().startsWith('bytes=')) return { kind: 'invalid' };
  const spec = value.slice('bytes='.length).trim();
  if (spec.length === 0 || spec.includes(',')) return { kind: 'invalid' };
  if (!Number.isInteger(size) || size < 0) return { kind: 'invalid' };
  if (size === 0) return { kind: 'invalid' };

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return { kind: 'invalid' };
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'invalid' };

  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'invalid' };
    const length = Math.min(suffix, size);
    return { kind: 'range', range: { start: size - length, end: size - 1 } };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
    return { kind: 'invalid' };
  }

  if (rawEnd === '') {
    return { kind: 'range', range: { start, end: size - 1 } };
  }

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return { kind: 'invalid' };
  return { kind: 'range', range: { start, end: Math.min(end, size - 1) } };
}

export function contentRange(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}
