import { computed, inject, Injectable, signal } from '@angular/core';
import type { DownloadProgress, DownloadStats } from '@statocyst/contracts';
import { bridge, bridgeAvailable } from './bridge';
import { ToastStore } from './toast.store';

const EMPTY_STATS: DownloadStats = { count: 0, totalBytes: 0 };

/**
 * Tracks the protected (pinned) downloads. Only tracks whose file is present
 * and size-matched on disk are reported as downloaded, so the UI never shows a
 * false "available offline" indicator.
 */
@Injectable({ providedIn: 'root' })
export class DownloadsStore {
  private readonly toasts = inject(ToastStore);

  readonly downloadedIds = signal<Set<string>>(new Set());
  readonly stats = signal<DownloadStats>({ ...EMPTY_STATS });
  readonly progress = signal<DownloadProgress | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);

  private progressUnsubscribe: (() => void) | null = null;

  /** Whether this runtime can keep protected downloads at all. */
  readonly supported = bridgeAvailable() ? bridge().downloads.supported !== false : false;

  readonly isDownloaded = computed(() => {
    const ids = this.downloadedIds();
    return (trackId: string) => ids.has(trackId);
  });

  /** Fraction (0–1) of the in-flight download, or null when it has no size. */
  readonly activePercent = computed(() => {
    const current = this.progress();
    if (!current || current.done || !current.totalBytes) return null;
    return Math.max(0, Math.min(1, current.receivedBytes / current.totalBytes));
  });

  /** True while this specific track is downloading. */
  readonly isDownloading = computed(() => {
    const current = this.progress();
    return (trackId: string) => !!current && !current.done && current.trackId === trackId;
  });

  /** Batch download state (artist/album), or null when idle. */
  readonly batch = signal<{ total: number; done: number; failed: number; currentTitle: string | null } | null>(null);
  readonly isBatchRunning = computed(() => this.batch() !== null);
  readonly batchPercent = computed(() => {
    const b = this.batch();
    if (!b || b.total === 0) return null;
    return Math.min(100, Math.round((b.done / b.total) * 100));
  });

  async downloadMany(trackIds: string[], titleFor?: (id: string) => string): Promise<void> {
    const unique = [...new Set(trackIds)].filter((id) => !this.isDownloaded()(id));
    if (unique.length === 0) {
      this.toasts.success('Already downloaded', 'Every track in this selection is already saved.');
      return;
    }
    this.batch.set({ total: unique.length, done: 0, failed: 0, currentTitle: null });
    let failed = 0;
    for (const id of unique) {
      this.batch.update((b) => (b ? { ...b, currentTitle: titleFor?.(id) ?? null } : b));
      try {
        await this.download(id, titleFor?.(id));
      } catch {
        failed += 1;
      }
      this.batch.update((b) => (b ? { ...b, done: b.done + 1, failed } : b));
    }
    const done = unique.length - failed;
    this.batch.set(null);
    if (failed === 0) {
      this.toasts.success('Downloaded for offline', `${done} track${done === 1 ? '' : 's'} saved.`);
    } else {
      this.toasts.error('Some downloads failed', `${done} saved, ${failed} failed.`);
    }
    await this.refresh();
  }

  async init(): Promise<void> {
    if (this.loaded() || !bridgeAvailable()) return;
    this.ensureProgressSubscription();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const [list, stats] = await Promise.all([bridge().downloads.list(), bridge().downloads.stats()]);
      this.downloadedIds.set(new Set(list.filter((d) => d.verified).map((d) => d.trackId)));
      this.stats.set(stats);
      this.loaded.set(true);
    } catch (error) {
      this.toasts.error('Could not load downloads', String(error));
    }
  }

  async download(trackId: string, title?: string): Promise<void> {
    this.progress.set({ trackId, receivedBytes: 0, totalBytes: null, done: false, error: null });
    try {
      const result = await bridge().downloads.download(trackId);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      this.toasts.success('Downloaded for offline', title ?? 'Track');
      await this.refresh();
    } catch (error) {
      this.toasts.error('Download failed', String(error));
    } finally {
      this.progress.set(null);
    }
  }

  async remove(trackId: string, title?: string): Promise<void> {
    try {
      const result = await bridge().downloads.remove(trackId);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      if (result.value.removed) {
        this.toasts.success('Removed download', title ?? 'Track');
      }
      await this.refresh();
    } catch (error) {
      this.toasts.error('Could not remove download', String(error));
    }
  }

  private ensureProgressSubscription(): void {
    if (this.progressUnsubscribe || !bridgeAvailable()) return;
    this.progressUnsubscribe = bridge().downloads.onProgress((progress) => {
      this.progress.set(progress);
      if (progress.done) void this.refresh();
    });
  }
}
