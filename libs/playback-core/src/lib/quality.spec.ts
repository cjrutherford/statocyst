import { describe, expect, it } from 'vitest';
import {
  CRITICAL_BUFFER_SECONDS,
  RollingThroughput,
  THROUGHPUT_HEADROOM,
  decideQuality,
  type QualityInput,
} from './quality';

const base: QualityInput = {
  preference: 'lossless',
  directPlaySupported: true,
  transcodeAvailable: true,
  sourceBitsPerSecond: 1_411_200, // 16-bit / 44.1 kHz stereo, lossless
  measuredBitsPerSecond: 8_000_000,
  bufferSeconds: 30,
  metered: false,
};

describe('adaptive quality policy', () => {
  it('direct-plays a compatible source with ample throughput', () => {
    const decision = decideQuality(base);
    expect(decision.mode).toBe('direct');
    expect(decision.reason).toBe('compatible');
  });

  it('does not force a transcode when throughput is healthy even if the buffer is low', () => {
    const decision = decideQuality({ ...base, bufferSeconds: 0.5, preference: 'auto' });
    expect(decision.mode).toBe('direct');
  });

  it('respects lossless preference under a thin margin', () => {
    const decision = decideQuality({
      ...base,
      measuredBitsPerSecond: base.sourceBitsPerSecond!, // just at the source rate
      bufferSeconds: CRITICAL_BUFFER_SECONDS + 5,
    });
    expect(decision.mode).toBe('direct');
    expect(decision.reason).toBe('lossless-preferred');
  });

  it('transcodes adaptively when throughput drops below the source rate', () => {
    const decision = decideQuality({
      ...base,
      preference: 'auto',
      measuredBitsPerSecond: 600_000,
      bufferSeconds: 12,
    });
    expect(decision.mode).toBe('transcode');
    expect(decision.reason).toBe('throughput-low');
  });

  it('transcodes lossless playback when the buffer is critical and throughput is low', () => {
    const decision = decideQuality({
      ...base,
      measuredBitsPerSecond: 600_000,
      bufferSeconds: CRITICAL_BUFFER_SECONDS - 1,
    });
    expect(decision.mode).toBe('transcode');
    expect(decision.reason).toBe('buffer-critical');
  });

  it('keeps direct play while throughput is still unmeasured and the buffer is healthy', () => {
    const decision = decideQuality({ ...base, measuredBitsPerSecond: null });
    expect(decision.mode).toBe('direct');
    expect(decision.reason).toBe('network-unknown');
  });

  it('transcodes an incompatible codec when a transcode target exists', () => {
    const decision = decideQuality({ ...base, directPlaySupported: false });
    expect(decision.mode).toBe('transcode');
    expect(decision.reason).toBe('incompatible-codec');
  });

  it('reports unavailable when neither direct play nor transcode is possible', () => {
    const decision = decideQuality({
      ...base,
      directPlaySupported: false,
      transcodeAvailable: false,
    });
    expect(decision.mode).toBe('unavailable');
  });

  it('applies the documented headroom', () => {
    expect(THROUGHPUT_HEADROOM).toBe(1.15);
  });
});

describe('RollingThroughput', () => {
  it('measures bytes over the sample window', () => {
    const meter = new RollingThroughput(10_000);
    meter.record(1_000, 0);
    meter.record(125_000, 1_000);
    // 125 kB over 1 s = 1 Mbit/s
    expect(meter.bitsPerSecond(1_000)).toBeCloseTo(1_000_000, 0);
  });

  it('drops samples outside the window', () => {
    const meter = new RollingThroughput(5_000);
    meter.record(10_000, 0);
    meter.record(10_000, 100);
    expect(meter.bitsPerSecond(20_000)).toBeNull();
  });

  it('returns null until two samples exist', () => {
    const meter = new RollingThroughput();
    meter.record(500, 0);
    expect(meter.bitsPerSecond(0)).toBeNull();
  });
});
