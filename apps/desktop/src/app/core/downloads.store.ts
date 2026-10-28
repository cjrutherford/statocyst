import { computed, inject, Injectable, signal } from '@angular/core';
import type {
  DownloadProgress,
  DownloadQueueEntry,
  DownloadQueueSnapshot,
  DownloadStats,
} from '@statocyst/contracts';
import { bridge, bridgeAvailable } from './bridge';
import { LibraryStore } from './library.store';
import { ToastStore } from './toast.store';

const EMPTY_STATS: DownloadStats = { count: 0, totalBytes: 0 };

export type DownloadStatusKind = 'active' | 'retrying' | 'waiting' | 'done' | 'failed';

/** What the UI shows for the whole queue; one source for every progress surface. */
export interface DownloadStatus {
  kind: DownloadStatusKind;
  total: number;
  done: number;
  failed: number;
  /** 0–100, from bytes when every size is known, otherwise from finished tracks. */
  percent: number;
  receivedBytes: number;
  totalBytes: number | null;
  /** Headline, e.g. "Downloading 12 of 40". */
  title: string;
  /** Secondary line: current track(s) or the reason for a pause. */
  detail: string;
  failedEntries: { trackId: string; title: string; error: string }[];
}

/**
 * Tracks the protected (pinned) downloads. Only tracks whose file is present
 * and size-matched on disk are reported as downloaded, so the UI never shows a
 * false "available offline" indicator.
 *
 * On Android the work happens in a native queue (foreground service) that
 * survives the screen turning off and retries/resumes on network drops; this
 * store only mirrors its snapshot. Elsewhere it falls back to one download at a
 * time through the bridge.
 */
@Injectable({ providedIn: 'root' })
export class DownloadsStore {
  private readonly toasts = inject(ToastStore);
  private readonly library = inject(LibraryStore);

  readonly downloadedIds = signal<Set<string>>(new Set());
  readonly stats = signal<DownloadStats>({ ...EMPTY_STATS });
  readonly progress = signal<DownloadProgress | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);

  /** Native queue snapshot (null when this runtime has no queue or it was never used). */
  readonly queue = signal<DownloadQueueSnapshot | null>(null);

  private progressUnsubscribe: (() => void) | null = null;
  private queueUnsubscribe: (() => void) | null = null;
  private announced = true;
  private lastDone = 0;
  private readonly titles = new Map<string, string>();

  /** Whether this runtime can keep protected downloads at all. */
  readonly supported = bridgeAvailable() ? bridge().downloads.supported !== false : false;
  private readonly hasQueue = bridgeAvailable() && typeof bridge().downloads.enqueue === 'function';

  readonly isDownloaded = computed(() => {
    const ids = this.downloadedIds();
    return (trackId: string) => ids.has(trackId);
  });

  private readonly entryById = computed(() => {
    const map = new Map<string, DownloadQueueEntry>();
    for (const entry of this.queue()?.entries ?? []) map.set(entry.trackId, entry);
    return map;
  });

  /** Queue state of one track: queued, active, retrying, waiting, failed, done — or null. */
  readonly trackState = computed(() => {
    const map = this.entryById();
    return (trackId: string) => map.get(trackId)?.state ?? null;
  });

  /** Fraction (0–1) of the in-flight download, or null when it has no size. */
  readonly activePercent = computed(() => {
    const current = this.progress();
    if (!current || current.done || !current.totalBytes) return null;
    return Math.max(0, Math.min(1, current.receivedBytes / current.totalBytes));
  });

  /** Fraction (0–1) of one queued track, or null when its size is not known yet. */
  readonly trackFraction = computed(() => {
    const map = this.entryById();
    return (trackId: string): number | null => {
      const entry = map.get(trackId);
      if (!entry?.totalBytes) return null;
      return Math.max(0, Math.min(1, entry.receivedBytes / entry.totalBytes));
    };
  });

  /** True while this specific track is waiting for or receiving a download. */
  readonly isDownloading = computed(() => {
    const current = this.progress();
    const map = this.entryById();
    return (trackId: string) => {
      const state = map.get(trackId)?.state;
      if (state) return state !== 'failed' && state !== 'done';
      return !!current && !current.done && current.trackId === trackId;
    };
  });

  /** Whole-queue status for the shared progress surface, or null when there is nothing to show. */
  readonly status = computed<DownloadStatus | null>(() => {
    const q = this.queue();
    if (!q || q.total === 0) return null;
    const finishedCount = q.done + q.failed;
    const byBytes = q.sizesKnown && q.totalBytes != null && q.totalBytes > 0;
    const percent = q.finished
      ? Math.round((q.done / q.total) * 100)
      : byBytes
        ? Math.min(99, Math.floor((q.receivedBytes / (q.totalBytes as number)) * 100))
        : Math.min(99, Math.floor((finishedCount / q.total) * 100));

    const running = q.entries.filter((e) => e.state === 'active' || e.state === 'retrying' || e.state === 'waiting');
    const waiting = running.some((e) => e.state === 'waiting');
    const retrying = running.find((e) => e.state === 'retrying');
    const names = running.map((e) => this.titleOf(e.trackId));
    const failedEntries = q.entries
      .filter((e) => e.state === 'failed')
      .map((e) => ({ trackId: e.trackId, title: this.titleOf(e.trackId), error: e.error ?? 'Download failed' }));

    let kind: DownloadStatusKind;
    let title: string;
    let detail: string;
    if (q.finished) {
      kind = q.failed > 0 ? 'failed' : 'done';
      title = q.failed > 0 ? `${q.done} saved, ${q.failed} failed` : `${q.done} track${q.done === 1 ? '' : 's'} saved offline`;
      detail = q.failed > 0 ? 'Retry the failed tracks or dismiss this message.' : 'Finished.';
    } else {
      kind = waiting ? 'waiting' : retrying ? 'retrying' : 'active';
      title = `Downloading ${Math.min(finishedCount + 1, q.total)} of ${q.total}`;
      detail = waiting
        ? 'Waiting for network — will continue automatically'
        : retrying
          ? `Connection problem, retrying (attempt ${retrying.attempt + 1})`
          : names.length > 0
            ? names.join(' · ')
            : 'Starting…';
    }
    return {
      kind, total: q.total, done: q.done, failed: q.failed, percent,
      receivedBytes: q.receivedBytes, totalBytes: q.sizesKnown ? q.totalBytes : null,
      title, detail, failedEntries,
    };
  });

  /** Batch download state, kept for existing views: derived from the queue when there is one. */
  private readonly jsBatch = signal<{ total: number; done: number; failed: number; currentTitle: string | null } | null>(null);
  readonly batch = computed(() => {
    const q = this.queue();
    if (q && !q.finished && q.total > 0) {
      return { total: q.total, done: q.done + q.failed, failed: q.failed, currentTitle: null };
    }
    return this.jsBatch();
  });
  readonly isBatchRunning = computed(() => this.batch() !== null);
  readonly batchPercent = computed(() => {
    const status = this.status();
    if (this.queue() && status && status.kind !== 'done' && status.kind !== 'failed') return status.percent;
    const b = this.jsBatch();
    if (!b || b.total === 0) return null;
    return Math.min(100, Math.round((b.done / b.total) * 100));
  });

  async downloadMany(trackIds: string[], titleFor?: (id: string) => string): Promise<void> {
    const unique = [...new Set(trackIds)].filter((id) => !this.isDownloaded()(id));
    if (unique.length === 0) {
      this.toasts.success('Already downloaded', 'Every track in this selection is already saved.');
      return;
    }
    if (this.hasQueue) {
      await this.enqueue(unique, titleFor);
      return;
    }
    this.jsBatch.set({ total: unique.length, done: 0, failed: 0, currentTitle: null });
    let failed = 0;
    for (const id of unique) {
      this.jsBatch.update((b) => (b ? { ...b, currentTitle: titleFor?.(id) ?? null } : b));
      const ok = await this.download(id, titleFor?.(id), { quiet: true });
      if (!ok) failed += 1;
      this.jsBatch.update((b) => (b ? { ...b, done: b.done + 1, failed } : b));
    }
    const done = unique.length - failed;
    this.jsBatch.set(null);
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
    this.ensureQueueSubscription();
    await this.refresh();
    if (this.hasQueue) {
      try {
        // Pick up work that kept running (or finished) while the UI was gone, without re-announcing it.
        const snapshot = await bridge().downloads.queue!();
        this.announced = snapshot.finished || snapshot.total === 0;
        this.applyQueue(snapshot, false);
      } catch {
        /* the queue is optional */
      }
    }
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

  async download(trackId: string, title?: string, options: { quiet?: boolean } = {}): Promise<boolean> {
    if (this.hasQueue) {
      await this.enqueue([trackId], title ? () => title : undefined);
      return true;
    }
    this.progress.set({ trackId, receivedBytes: 0, totalBytes: null, done: false, error: null });
    try {
      const result = await bridge().downloads.download(trackId);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return false;
      }
      if (!options.quiet) this.toasts.success('Downloaded for offline', title ?? 'Track');
      await this.refresh();
      return true;
    } catch (error) {
      this.toasts.error('Download failed', String(error));
      return false;
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

  async cancelQueue(): Promise<void> {
    await this.queueCall((d) => d.cancelQueue!());
  }

  async retryFailed(): Promise<void> {
    this.announced = false;
    await this.queueCall((d) => d.retryFailed!());
  }

  async dismissQueue(): Promise<void> {
    await this.queueCall((d) => d.dismissQueue!());
  }

  private async enqueue(trackIds: string[], titleFor?: (id: string) => string): Promise<void> {
    this.ensureQueueSubscription();
    for (const id of trackIds) {
      const title = titleFor?.(id);
      if (title) this.titles.set(id, title);
    }
    this.announced = false;
    try {
      this.applyQueue(await bridge().downloads.enqueue!(trackIds), false);
    } catch (error) {
      this.announced = true;
      this.toasts.error('Could not start the download', String(error));
    }
  }

  private async queueCall(call: (d: ReturnType<typeof bridge>['downloads']) => Promise<DownloadQueueSnapshot>): Promise<void> {
    if (!this.hasQueue) return;
    try {
      this.applyQueue(await call(bridge().downloads), false);
    } catch (error) {
      this.toasts.error('Download action failed', String(error));
    }
  }

  private titleOf(trackId: string): string {
    return (
      this.titles.get(trackId) ??
      this.library.tracks().find((t) => t.id === trackId)?.title ??
      'Track'
    );
  }

  private applyQueue(snapshot: DownloadQueueSnapshot, announce: boolean): void {
    this.queue.set(snapshot.total === 0 ? null : snapshot);
    // Keep the saved-for-offline indicators current as each track lands.
    if (snapshot.done !== this.lastDone) {
      this.lastDone = snapshot.done;
      void this.refresh();
    }
    if (snapshot.pending > 0) this.announced = false;
    if (snapshot.finished && !this.announced && announce) {
      this.announced = true;
      if (snapshot.failed === 0) {
        this.toasts.success('Downloaded for offline', `${snapshot.done} track${snapshot.done === 1 ? '' : 's'} saved.`);
      } else {
        this.toasts.error('Some downloads failed', `${snapshot.done} saved, ${snapshot.failed} failed.`);
      }
      void this.refresh();
    }
  }

  private ensureQueueSubscription(): void {
    if (this.queueUnsubscribe || !this.hasQueue) return;
    this.queueUnsubscribe = bridge().downloads.onQueue?.((snapshot) => this.applyQueue(snapshot, true)) ?? null;
  }

  private ensureProgressSubscription(): void {
    if (this.progressUnsubscribe || !bridgeAvailable()) return;
    this.progressUnsubscribe = bridge().downloads.onProgress((progress) => {
      this.progress.set(progress);
      if (progress.done) void this.refresh();
    });
  }
}
