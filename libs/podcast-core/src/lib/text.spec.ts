import { describe, expect, it } from 'vitest';
import { decodeEntities, extractLinks, stripHtml } from '../index';

describe('feed text sanitization', () => {
  it('decodes entities and never returns markup', () => {
    expect(decodeEntities('&amp;&#65;&#x42;')).toBe('&AB');
    expect(
      stripHtml('<p>Hello &amp; <strong>world</strong><script>alert(1)</script></p>'),
    ).toBe('Hello & world');
    expect(stripHtml('&lt;p&gt;Encoded &amp;amp; markup&lt;/p&gt;')).toBe('Encoded & markup');
  });

  it('extracts only safe HTTP(S) links and resolves relative URLs', () => {
    const links = extractLinks(
      '<a href="javascript:alert(1)">bad</a>' +
        '<a href="/notes/1">Notes</a>' +
        '<a href="data:text/html,x">data</a>' +
        '<a href="https://user:pass@example.com/x">credential</a>' +
        '<a href="https://example.com/ok">OK</a>',
      'https://feeds.example.com/feed.xml',
    );
    expect(links).toEqual([
      { title: 'Notes', url: 'https://feeds.example.com/notes/1' },
      { title: 'OK', url: 'https://example.com/ok' },
    ]);
  });

  it('dedupes links and respects the limit', () => {
    const html = Array.from(
      { length: 5 },
      (_, index) => `<a href="https://example.com/${index}">${index}</a>`,
    ).join('');
    expect(extractLinks(html, 'https://example.com/feed', 3)).toHaveLength(3);
    expect(
      extractLinks('<a href="https://example.com/x">x</a><a href="https://example.com/x">x</a>', 'https://example.com/feed'),
    ).toHaveLength(1);
  });
});
