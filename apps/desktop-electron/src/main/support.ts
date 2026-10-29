import { readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AppInfo,
  DiagnosticsInfo,
  HealthCheck,
  Settings,
} from '@statocyst/contracts';
import type { StatocystDatabase } from '@statocyst/persistence';
import { redactValue } from './logger';

/** Recent log lines included in a bundle. Bounded so exports stay small. */
export const LOG_TAIL_LINES = 400;

const MIN_FREE_BYTES = 256 * 1024 * 1024;
const LOG_WARN_BYTES = 10 * 1024 * 1024;

export interface HealthOptions {
  database: StatocystDatabase;
  dataDirectory: string;
  logPath: string;
  cacheBudgetBytes: number;
}

/**
 * Local-only health checks (ADR-015, Q19). Each check must never throw: a
 * failing probe becomes a `fail` result with a short reason so the UI and the
 * support bundle always have a complete picture.
 */
export async function collectHealth(options: HealthOptions): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  try {
    const integrity = await options.database.integrityCheck();
    checks.push({
      id: 'database-integrity',
      label: 'Database integrity',
      status: integrity === 'ok' ? 'ok' : 'fail',
      detail: integrity === 'ok' ? 'PRAGMA integrity_check passed' : `Integrity check returned ${integrity}`,
    });
  } catch (error) {
    checks.push({
      id: 'database-integrity',
      label: 'Database integrity',
      status: 'fail',
      detail: `Check failed: ${String(error)}`,
    });
  }

  try {
    const version = await options.database.schemaVersion();
    checks.push({
      id: 'schema',
      label: 'Schema version',
      status: version >= 1 ? 'ok' : 'warn',
      detail: version >= 1 ? `Migration ${version} applied` : 'No migrations recorded yet',
    });
  } catch (error) {
    checks.push({
      id: 'schema',
      label: 'Schema version',
      status: 'fail',
      detail: `Check failed: ${String(error)}`,
    });
  }

  const probePath = join(options.dataDirectory, '.health-probe');
  try {
    await writeFile(probePath, 'statocyst-health-probe', 'utf8');
    await readFile(probePath, 'utf8');
    checks.push({
      id: 'data-directory',
      label: 'Data directory',
      status: 'ok',
      detail: 'Writable and readable',
    });
  } catch (error) {
    checks.push({
      id: 'data-directory',
      label: 'Data directory',
      status: 'fail',
      detail: `Not writable: ${String(error)}`,
    });
  } finally {
    await unlink(probePath).catch(() => undefined);
  }

  try {
    const info = await stat(options.logPath);
    checks.push({
      id: 'log-file',
      label: 'Log file',
      status: info.size > LOG_WARN_BYTES ? 'warn' : 'ok',
      detail:
        info.size > LOG_WARN_BYTES
          ? `${Math.round(info.size / 1024 / 1024)} MiB; rotation will trim it on next start`
          : `${info.size} bytes`,
    });
  } catch {
    checks.push({
      id: 'log-file',
      label: 'Log file',
      status: 'warn',
      detail: 'No log file yet (no events written)',
    });
  }

  try {
    const fs = await statfs(options.dataDirectory);
    const free = Number(fs.bavail) * Number(fs.bsize);
    checks.push({
      id: 'disk-space',
      label: 'Free disk space',
      status: free < MIN_FREE_BYTES ? 'fail' : free < options.cacheBudgetBytes ? 'warn' : 'ok',
      detail:
        free < options.cacheBudgetBytes
          ? `${formatBytes(free)} free; below the ${formatBytes(options.cacheBudgetBytes)} cache budget`
          : `${formatBytes(free)} free`,
    });
  } catch (error) {
    checks.push({
      id: 'disk-space',
      label: 'Free disk space',
      status: 'warn',
      detail: `Could not read filesystem stats: ${String(error)}`,
    });
  }

  return checks;
}

export function sanitizeLogTail(text: string, maxLines = LOG_TAIL_LINES): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines);
}

export interface SupportBundleInput {
  app: AppInfo;
  diagnostics: DiagnosticsInfo;
  settings: Settings;
  health: HealthCheck[];
  logText: string;
}

/**
 * Builds the exported support bundle. Every value passes through the logger's
 * redaction pipeline, so a secret embedded in a log line or a settings field
 * cannot reach the file.
 */
export function buildSupportBundle(input: SupportBundleInput): string {
  const bundle = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    app: input.app,
    diagnostics: input.diagnostics,
    settings: input.settings,
    health: input.health,
    privacy: {
      externalReporting: false,
      listeningHistory: input.settings.listeningHistory,
      note: 'This bundle was written locally. Statocyst does not upload diagnostics.',
    },
    recentLogs: sanitizeLogTail(input.logText),
  };
  return `${JSON.stringify(redactValue(bundle), null, 2)}\n`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
