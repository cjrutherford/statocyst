import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEY = /(token|password|secret|authorization|cookie|credential|api[_-]?key)/i;

/**
 * Value-level scrubbing for secrets that appear inside otherwise harmless text
 * (log tails, error messages, URLs, upstream headers). Key-based redaction is
 * not enough because upstream responses and proxy errors can embed credentials
 * in a message body.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\bBearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[redacted]'],
  [/(\bBasic\s+)[A-Za-z0-9+/]+=*/gi, '$1[redacted]'],
  [/([?&](?:api[_-]?key|token|access[_-]?token|password|secret)=)[^&\s"'<>]+/gi, '$1[redacted]'],
  [
    /((?:token|password|secret|authorization|cookie|credential|api[_-]?key)\s*[:=]\s*"?)[^"\s,;}&\]]+/gi,
    '$1[redacted]',
  ],
  [/(\/\/)[^/@\s:]+:[^/@\s]+@/g, '$1[redacted]@'],
];

export function sanitizeText(value: string): string {
  let output = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  data?: unknown;
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? `${value.slice(0, max)}…[${value.length - max} chars]` : value;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(truncate(value.message)),
      stack: sanitizeText(truncate(value.stack ?? '')),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactValue(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === 'string') return sanitizeText(truncate(value));
  return value;
}

/**
 * Privacy-first local logger (ADR-021). Every record is JSONL, secrets are
 * redacted by key, and nothing is transmitted off the machine.
 */
export class Logger {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly filePath: string,
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly mirrorToConsole = false,
  ) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const info = await stat(this.filePath);
      if (info.size > this.maxBytes) {
        await rename(this.filePath, `${this.filePath}.1`).catch(() => undefined);
      }
    } catch {
      // First run: no log file yet.
    }
  }

  log(level: LogLevel, event: string, data?: unknown, correlationId?: string): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(correlationId ? { correlationId } : {}),
      ...(data === undefined ? {} : { data: redactValue(data) }),
    };
    const line = `${JSON.stringify(record)}\n`;
    if (this.mirrorToConsole) {
      const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      method(`[statocyst:${level}] ${event}`, record.data ?? '');
    }
    this.queue = this.queue
      .then(() => appendFile(this.filePath, line, 'utf8'))
      .catch((error) => {
        console.error('[statocyst] log write failed', error);
      });
  }

  debug(event: string, data?: unknown, correlationId?: string): void {
    this.log('debug', event, data, correlationId);
  }

  info(event: string, data?: unknown, correlationId?: string): void {
    this.log('info', event, data, correlationId);
  }

  warn(event: string, data?: unknown, correlationId?: string): void {
    this.log('warn', event, data, correlationId);
  }

  error(event: string, data?: unknown, correlationId?: string): void {
    this.log('error', event, data, correlationId);
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}
