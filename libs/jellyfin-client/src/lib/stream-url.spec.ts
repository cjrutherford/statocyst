import { describe, expect, it } from 'vitest';
import { buildAudioStreamUrl } from './stream-url';

describe('buildAudioStreamUrl', () => {
  it('builds a direct static stream URL', () => {
    const url = buildAudioStreamUrl({
      baseUrl: 'https://music.example.com/',
      itemId: 'item/1',
      mode: 'direct',
    });
    expect(url).toBe('https://music.example.com/Audio/item%2F1/stream?static=true');
  });

  it('builds a capped transcode URL on the universal endpoint', () => {
    const url = new URL(
      buildAudioStreamUrl({
        baseUrl: 'https://music.example.com',
        itemId: 'abc',
        mode: 'transcode',
        maxBitrateKbps: 320,
      }),
    );
    expect(url.pathname).toBe('/Audio/abc/universal');
    expect(url.searchParams.get('MaxStreamingBitrate')).toBe('320000');
    expect(url.searchParams.get('Container')).toBe('mp3');
    expect(url.searchParams.get('Static')).toBe('false');
  });

  it('passes a resume position for transcoded streams', () => {
    const url = new URL(
      buildAudioStreamUrl({
        baseUrl: 'https://music.example.com',
        itemId: 'abc',
        mode: 'transcode',
        maxBitrateKbps: 192,
        startPositionTicks: 10_000_000,
      }),
    );
    expect(url.searchParams.get('StartTimeTicks')).toBe('10000000');
  });

  it('refuses an HTTPS server downgraded to HTTP', () => {
    expect(() =>
      buildAudioStreamUrl({
        baseUrl: 'http://music.example.com',
        itemId: 'abc',
        mode: 'direct',
        allowInsecureLoopback: false,
      }),
    ).toThrow(/HTTPS/i);
  });

  it('requires a bitrate ceiling for transcoding', () => {
    expect(() =>
      buildAudioStreamUrl({
        baseUrl: 'https://music.example.com',
        itemId: 'abc',
        mode: 'transcode',
      }),
    ).toThrow(/maxBitrateKbps/);
  });
});
