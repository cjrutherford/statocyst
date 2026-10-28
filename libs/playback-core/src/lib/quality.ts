/**
 * Adaptive audio quality policy (ADR-013).
 *
 * The policy prefers direct play whenever the endpoint can sustain it. It only
 * requests a transcode when the device cannot decode the source or when the
 * measured throughput/buffer would stall playback. Therefore "lossless first"
 * never forces a needless transcode on a healthy connection.
 */

export type QualityPreference = 'lossless' | 'auto';
export type PlaybackMode = 'direct' | 'transcode' | 'unavailable';

export interface QualityInput {
  preference: QualityPreference;
  /** The device can decode the source codec/container as-is. */
  directPlaySupported: boolean;
  /** The server can produce a compatible transcode. */
  transcodeAvailable: boolean;
  /** Source bitrate in bits per second. */
  sourceBitsPerSecond: number | null;
  /** Measured throughput in bits per second, null when not yet sampled. */
  measuredBitsPerSecond: number | null;
  /** Seconds of audio currently buffered. */
  bufferSeconds: number;
  /** True when the connection is metered/cellular. */
  metered: boolean;
}

export type QualityReason =
  | 'compatible'
  | 'lossless-preferred'
  | 'throughput-low'
  | 'buffer-critical'
  | 'metered-source'
  | 'incompatible-codec'
  | 'no-transcode'
  | 'network-unknown';

export interface QualityDecision {
  mode: PlaybackMode;
  reason: QualityReason;
  /** Safety factor applied to the measured throughput (1.15 = 15% headroom). */
  headroom: number;
}

/** 15% headroom over the source bitrate before direct play is considered safe. */
export const THROUGHPUT_HEADROOM = 1.15;
/** Below this many buffered seconds a struggling connection is at risk. */
export const CRITICAL_BUFFER_SECONDS = 3;

function sustainable(measured: number | null, required: number | null): boolean {
  if (measured === null || required === null || required <= 0) return false;
  return measured >= required * THROUGHPUT_HEADROOM;
}

/**
 * Decides between direct play and transcode. Pure and deterministic so it can
 * be exercised by the network-disruption fixture.
 */
export function decideQuality(input: QualityInput): QualityDecision {
  const { preference, directPlaySupported, transcodeAvailable } = input;

  if (!directPlaySupported) {
    return transcodeAvailable
      ? { mode: 'transcode', reason: 'incompatible-codec', headroom: THROUGHPUT_HEADROOM }
      : { mode: 'unavailable', reason: 'no-transcode', headroom: THROUGHPUT_HEADROOM };
  }

  const healthy = sustainable(input.measuredBitsPerSecond, input.sourceBitsPerSecond);
  const criticalBuffer = input.bufferSeconds < CRITICAL_BUFFER_SECONDS;

  // Direct play is always correct when throughput sustains the source; a low
  // buffer alone is not a reason to transcode. This prevents needless forced
  // transcodes during startup and seeks.
  if (healthy) {
    return { mode: 'direct', reason: 'compatible', headroom: THROUGHPUT_HEADROOM };
  }

  if (input.measuredBitsPerSecond === null || input.sourceBitsPerSecond === null) {
    // No measurement yet: keep the source as-is unless it is already stalling.
    return criticalBuffer
      ? {
          mode: transcodeAvailable ? 'transcode' : 'direct',
          reason: transcodeAvailable ? 'buffer-critical' : 'network-unknown',
          headroom: THROUGHPUT_HEADROOM,
        }
      : { mode: 'direct', reason: 'network-unknown', headroom: THROUGHPUT_HEADROOM };
  }

  if (criticalBuffer) {
    return transcodeAvailable
      ? { mode: 'transcode', reason: 'buffer-critical', headroom: THROUGHPUT_HEADROOM }
      : { mode: 'direct', reason: 'throughput-low', headroom: THROUGHPUT_HEADROOM };
  }

  if (preference === 'lossless') {
    // Lossless preference tolerates a thin margin while the buffer is healthy.
    return { mode: 'direct', reason: 'lossless-preferred', headroom: THROUGHPUT_HEADROOM };
  }

  if (input.metered) {
    return transcodeAvailable
      ? { mode: 'transcode', reason: 'metered-source', headroom: THROUGHPUT_HEADROOM }
      : { mode: 'direct', reason: 'throughput-low', headroom: THROUGHPUT_HEADROOM };
  }

  return transcodeAvailable
    ? { mode: 'transcode', reason: 'throughput-low', headroom: THROUGHPUT_HEADROOM }
    : { mode: 'direct', reason: 'throughput-low', headroom: THROUGHPUT_HEADROOM };
}

export interface ThroughputSample {
  bytes: number;
  atMs: number;
}

/**
 * Rolling throughput estimator. Samples are kept for a bounded window so a
 * single burst cannot mask a sustained drop.
 */
export class RollingThroughput {
  private samples: ThroughputSample[] = [];

  constructor(private readonly windowMs = 8000) {}

  record(bytes: number, atMs = Date.now()): void {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.samples.push({ bytes, atMs });
    this.trim(atMs);
  }

  bitsPerSecond(nowMs = Date.now()): number | null {
    this.trim(nowMs);
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const elapsedMs = last.atMs - first.atMs;
    if (elapsedMs <= 0) return null;
    const totalBytes = this.samples.slice(1).reduce((sum, sample) => sum + sample.bytes, 0);
    return (totalBytes * 8 * 1000) / elapsedMs;
  }

  reset(): void {
    this.samples = [];
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].atMs < cutoff) {
      this.samples.shift();
    }
  }
}
