import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger, redactValue, sanitizeText } from './logger';

describe('sanitizeText', () => {
  it('redacts bearer and basic authorization values', () => {
    expect(sanitizeText('Authorization: Bearer abc.def-123')).not.toContain('abc.def-123');
    expect(sanitizeText('authorization=Basic dXNlcjpwYXNz')).not.toContain('dXNlcjpwYXNz');
  });

  it('redacts query-string credentials', () => {
    const output = sanitizeText('https://media.example/Audio/1/stream?api_key=deadbeef&x=1');
    expect(output).not.toContain('deadbeef');
    expect(output).toContain('x=1');
  });

  it('redacts inline token and password assignments', () => {
    expect(sanitizeText('MediaBrowser Token="tok-999", Client="Statocyst"')).not.toContain('tok-999');
    expect(sanitizeText('password=hunter2')).not.toContain('hunter2');
  });

  it('redacts credentials embedded in a URL', () => {
    const output = sanitizeText('fetch https://alice:s3cret@jellyfin.example/Items');
    expect(output).not.toContain('s3cret');
    expect(output).toContain('jellyfin.example');
  });

  it('leaves ordinary prose alone', () => {
    const prose = 'the token refreshed after the queue advanced';
    expect(sanitizeText(prose)).toBe(prose);
  });
});

describe('redactValue', () => {
  it('redacts secret-named keys at any depth', () => {
    const redacted = redactValue({
      server: { url: 'https://jellyfin.example', token: 'secret-token' },
      headers: { Authorization: 'Bearer xyz' },
      password: 'hunter2',
      keep: 'visible',
    }) as Record<string, unknown>;
    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
    expect(JSON.stringify(redacted)).not.toContain('xyz');
    expect(JSON.stringify(redacted)).toContain('visible');
  });

  it('sanitizes error messages and stacks', () => {
    const error = new Error('upstream rejected Bearer abc123');
    const redacted = redactValue(error) as { message: string };
    expect(redacted.message).not.toContain('abc123');
  });
});

describe('Logger', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'statocyst-log-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes JSONL with secrets removed', async () => {
    const filePath = join(directory, 'main.jsonl');
    const logger = new Logger(filePath);
    await logger.init();
    logger.info('jellyfin.connect', {
      url: 'https://jellyfin.example/Audio/1?api_key=deadbeef',
      token: 'tok-999',
      nested: { Authorization: 'Bearer abc123' },
    });
    logger.error('playback.failed', new Error('upstream said no to Bearer abc123'));
    await logger.flush();

    const text = await readFile(filePath, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(text).not.toContain('deadbeef');
    expect(text).not.toContain('tok-999');
    expect(text).not.toContain('abc123');
    expect(text).toContain('jellyfin.connect');
    expect(text).toContain('[redacted]');
  });
});
