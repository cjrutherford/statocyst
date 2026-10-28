import { assertSecureBaseUrl, normalizeBaseUrl } from './jellyfin-client';

export type AudioStreamMode = 'direct' | 'transcode';

export interface AudioStreamOptions {
  baseUrl: string;
  itemId: string;
  /** Direct streams the original file; transcode asks Jellyfin for a capped stream. */
  mode: AudioStreamMode;
  /** Required for transcode: the server-side bitrate ceiling in kbit/s. */
  maxBitrateKbps?: number;
  /** Target container for transcoding (default `mp3`). */
  container?: string;
  /** Target audio codec for transcoding (default `mp3`). */
  audioCodec?: string;
  /** Optional resume position in 100-ns ticks. */
  startPositionTicks?: number;
  /** Allow plain HTTP for loopback fixtures (default true). */
  allowInsecureLoopback?: boolean;
}

/**
 * Builds a Jellyfin audio stream URL. Refuses to construct a URL that would
 * downgrade an HTTPS server to plain HTTP, keeping ADR-004's transport
 * invariant at the single place URLs are produced.
 */
export function buildAudioStreamUrl(options: AudioStreamOptions): string {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) throw new Error('The server URL is not valid');
  const insecure = assertSecureBaseUrl(baseUrl, options.allowInsecureLoopback ?? true);
  if (insecure) throw insecure;

  const itemId = encodeURIComponent(options.itemId);

  if (options.mode === 'direct') {
    return `${baseUrl}/Audio/${itemId}/stream?static=true`;
  }

  const bitrateKbps = options.maxBitrateKbps;
  if (bitrateKbps === undefined || !Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    throw new Error('A positive maxBitrateKbps is required for transcoding');
  }
  const container = options.container ?? 'mp3';
  const audioCodec = options.audioCodec ?? 'mp3';
  const params = new URLSearchParams({
    MaxStreamingBitrate: String(Math.round(bitrateKbps * 1000)),
    Container: container,
    AudioCodec: audioCodec,
    TranscodingContainer: container,
    TranscodingProtocol: 'http',
    Static: 'false',
  });
  if (options.startPositionTicks !== undefined && options.startPositionTicks > 0) {
    params.set('StartTimeTicks', String(Math.floor(options.startPositionTicks)));
  }
  return `${baseUrl}/Audio/${itemId}/universal?${params.toString()}`;
}
