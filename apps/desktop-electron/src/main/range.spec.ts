import { describe, expect, it } from 'vitest';
import { contentRange, parseRangeHeader } from './range';

describe('byte range parsing', () => {
  it('treats absent and empty headers as full responses', () => {
    expect(parseRangeHeader(undefined, 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader(null, 100)).toEqual({ kind: 'none' });
    expect(parseRangeHeader('   ', 100)).toEqual({ kind: 'none' });
  });

  it('parses bounded, open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-49', 100)).toEqual({
      kind: 'range',
      range: { start: 0, end: 49 },
    });
    expect(parseRangeHeader('bytes=50-', 100)).toEqual({
      kind: 'range',
      range: { start: 50, end: 99 },
    });
    expect(parseRangeHeader('bytes=-20', 100)).toEqual({
      kind: 'range',
      range: { start: 80, end: 99 },
    });
  });

  it('clamps oversized ends and suffix lengths', () => {
    expect(parseRangeHeader('bytes=90-9999', 100)).toEqual({
      kind: 'range',
      range: { start: 90, end: 99 },
    });
    expect(parseRangeHeader('bytes=-500', 100)).toEqual({
      kind: 'range',
      range: { start: 0, end: 99 },
    });
  });

  it('rejects malformed, multi-range and unusable ranges', () => {
    for (const header of [
      'items=0-10',
      'bytes=',
      'bytes=0-10,20-30',
      'bytes=abc-def',
      'bytes=-',
      'bytes=10-5',
      'bytes=100-',
      'bytes=200-300',
    ]) {
      expect(parseRangeHeader(header, 100), header).toEqual({ kind: 'invalid' });
    }
    expect(parseRangeHeader('bytes=0-0', 0)).toEqual({ kind: 'invalid' });
    expect(parseRangeHeader('bytes=0-0', -1)).toEqual({ kind: 'invalid' });
  });

  it('formats content-range headers', () => {
    expect(contentRange({ start: 0, end: 9 }, 100)).toBe('bytes 0-9/100');
    expect(contentRange({ start: 90, end: 99 }, 100)).toBe('bytes 90-99/100');
  });
});
