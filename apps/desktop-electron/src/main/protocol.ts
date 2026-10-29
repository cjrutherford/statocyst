import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { contentRange, parseRangeHeader } from './range';
import { buildAudioStreamUrl, type ClientIdentity } from '@statocyst/jellyfin-client';
import { RollingThroughput } from '@statocyst/playback-core';

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

export interface RemoteTrack {
  serverUrl: string;
  itemId: string;
  token: string;
  /** Direct play by default; transcode when the quality policy requests it. */
  mode?: 'direct' | 'transcode';
  /** Bitrate ceiling in kbit/s, required for transcode. */
  maxBitrateKbps?: number;
}

export interface ProtocolTrack {
  id: string;
  path: string;
  artworkPath: string | null;
  remote?: RemoteTrack | null;
}

export interface ProtocolOptions {
  lookupTrack: (trackId: string) => Promise<ProtocolTrack | null>;
  onMediaUnavailable?: (trackId: string) => void;
  remoteIdentity?: ClientIdentity;
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

function remoteAuthorization(identity: ClientIdentity | undefined, token: string): string {
  const client = identity?.client ?? 'Statocyst';
  const device = identity?.device ?? 'Statocyst';
  const deviceId = identity?.deviceId ?? 'statocyst-protocol';
  const version = identity?.version ?? '0.1.0';
  return `MediaBrowser Client="${client}", Device="${device}", DeviceId="${deviceId}", Version="${version}", Token="${token}"`;
}

async function proxyRemoteStream(
  remote: RemoteTrack,
  request: Request,
  identity: ClientIdentity | undefined,
  meter: RollingThroughput,
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: remoteAuthorization(identity, remote.token) };
  const range = request.headers.get('range');
  if (range) headers['Range'] = range;
  let upstream: Response;
  try {
    upstream = await fetch(
      buildAudioStreamUrl({
        baseUrl: remote.serverUrl,
        itemId: remote.itemId,
        mode: remote.mode ?? 'direct',
        maxBitrateKbps: remote.maxBitrateKbps,
      }),
      { method: request.method, headers, redirect: 'manual' },
    );
  } catch {
    return new Response('Media unavailable', { status: 502 });
  }
  if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404) {
    return new Response('Media unavailable', { status: 404 });
  }
  const responseHeaders: Record<string, string> = {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  return new Response(request.method === 'HEAD' ? null : tapThroughput(upstream.body, meter), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/** Counts bytes as they are proxied so the quality policy has a real sample. */
function tapThroughput(
  body: ReadableStream<Uint8Array> | null,
  meter: RollingThroughput,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value) {
        meter.record(value.byteLength);
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function proxyRemoteArt(remote: RemoteTrack, identity?: ClientIdentity): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(
      `${remote.serverUrl}/Items/${encodeURIComponent(remote.itemId)}/Images/Primary?maxHeight=512&quality=90`,
      { headers: { Authorization: remoteAuthorization(identity, remote.token) }, redirect: 'manual' },
    );
  } catch {
    return new Response('Artwork unavailable', { status: 502 });
  }
  if (!upstream.ok) return new Response('Artwork not found', { status: 404 });
  const data = await upstream.arrayBuffer();
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Content-Length': String(data.byteLength),
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export interface ProtocolMeter {
  /** Measured proxy throughput in bits per second, or null before two samples. */
  throughputBitsPerSecond(): number | null;
}

export function registerProtocols(options: ProtocolOptions): ProtocolMeter {
  const meter = new RollingThroughput(8000);
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const trackId = trackIdFromUrl(request.url, MEDIA_SCHEME);
    if (!trackId) return new Response('Malformed media URL', { status: 400 });

    const track = await options.lookupTrack(trackId).catch(() => null);
    if (!track) return new Response('Track not found', { status: 404 });

    if (track.remote) {
      return proxyRemoteStream(track.remote, request, options.remoteIdentity, meter);
    }

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
    if (!track) return new Response('Artwork not found', { status: 404 });

    if (track.remote) {
      return proxyRemoteArt(track.remote, options.remoteIdentity);
    }

    if (!track.artworkPath) return new Response('Artwork not found', { status: 404 });

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

  return {
    throughputBitsPerSecond: () => meter.bitsPerSecond(),
  };
}