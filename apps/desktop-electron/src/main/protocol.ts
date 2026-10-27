import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { contentRange, parseRangeHeader } from './range';

import { ART_SCHEME, MEDIA_SCHEME } from './schemes';

export { ART_SCHEME, MEDIA_SCHEME };

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
};

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export interface ProtocolTrack {
  id: string;
  path: string;
  artworkPath: string | null;
}

export interface ProtocolOptions {
  lookupTrack: (trackId: string) => Promise<ProtocolTrack | null>;
  onMediaUnavailable?: (trackId: string) => void;
}

function trackIdFromUrl(url: string, scheme: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${scheme}:`) return null;
  const id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!id || id.includes('/') || id.includes('\\')) return null;
  return id;
}

function streamBetween(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as unknown as ReadableStream;
}

function baseHeaders(type: string): Record<string, string> {
  return {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function registerProtocols(options: ProtocolOptions): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const trackId = trackIdFromUrl(request.url, MEDIA_SCHEME);
    if (!trackId) return new Response('Malformed media URL', { status: 400 });

    const track = await options.lookupTrack(trackId).catch(() => null);
    if (!track) return new Response('Track not found', { status: 404 });

    let info;
    try {
      info = await stat(track.path);
    } catch {
      options.onMediaUnavailable?.(trackId);
      return new Response('Media unavailable', { status: 404 });
    }
    if (!info.isFile()) {
      options.onMediaUnavailable?.(trackId);
      return new Response('Media unavailable', { status: 404 });
    }

    const type = AUDIO_MIME[extname(track.path).replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream';
    const parsed = parseRangeHeader(request.headers.get('range'), info.size);

    if (info.size === 0) {
      return new Response(null, {
        status: 200,
        headers: { ...baseHeaders(type), 'Content-Length': '0' },
      });
    }

    if (parsed.kind === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders(type),
          'Content-Range': `bytes */${info.size}`,
        },
      });
    }

    if (parsed.kind === 'range') {
      const { start, end } = parsed.range;
      return new Response(
        request.method === 'HEAD' ? null : streamBetween(track.path, start, end),
        {
          status: 206,
          headers: {
            ...baseHeaders(type),
            'Content-Length': String(end - start + 1),
            'Content-Range': contentRange(parsed.range, info.size),
          },
        },
      );
    }

    return new Response(
      request.method === 'HEAD' ? null : streamBetween(track.path, 0, Math.max(0, info.size - 1)),
      {
        status: 200,
        headers: {
          ...baseHeaders(type),
          'Content-Length': String(info.size),
        },
      },
    );
  });

  protocol.handle(ART_SCHEME, async (request) => {
    const trackId = trackIdFromUrl(request.url, ART_SCHEME);
    if (!trackId) return new Response('Malformed artwork URL', { status: 400 });

    const track = await options.lookupTrack(trackId).catch(() => null);
    if (!track?.artworkPath) return new Response('Artwork not found', { status: 404 });

    try {
      const data = await readFile(track.artworkPath);
      const type =
        IMAGE_MIME[extname(track.artworkPath).replace(/^\./, '').toLowerCase()] ??
        'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Artwork unavailable', { status: 404 });
    }
  });
}
