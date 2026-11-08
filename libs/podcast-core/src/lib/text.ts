import type { PodcastEpisodeLink } from '@statocyst/contracts';
import { resolveHttpUrl } from './url';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Convert feed HTML to safe display text. Markup is never returned. */
export function stripHtml(value: string): string {
  if (!value) return '';
  const withoutBlocks = decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withBreaks = withoutBlocks
    .replace(/<(?:br|hr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr|section|article)>/gi, '\n');
  const withoutTags = withBreaks.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 100_000);
}

/** Extract at most `limit` safe HTTP(S) links from feed HTML. */
export function extractLinks(
  value: string,
  baseUrl: string,
  limit = 20,
): PodcastEpisodeLink[] {
  if (!value) return [];
  const links: PodcastEpisodeLink[] = [];
  const seen = new Set<string>();
  const decoded = decodeEntities(value);
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(decoded)) !== null && links.length < limit) {
    const href = match[1] ?? match[2] ?? match[3] ?? '';
    const url = resolveHttpUrl(decodeEntities(href).trim(), baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = stripHtml(match[4] ?? '').slice(0, 200);
    links.push({ title: title.length > 0 ? title : null, url });
  }
  return links;
}
