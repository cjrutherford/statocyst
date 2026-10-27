import { computed, inject, Injectable, signal } from '@angular/core';
import type { ImportProgress, ImportSummary, LibraryStats, Track } from '@statocyst/contracts';
import { bridge, bridgeAvailable } from './bridge';
import { PlaybackStore } from './playback.store';
import { ToastStore } from './toast.store';

const EMPTY_STATS: LibraryStats = {
  tracks: 0,
  albums: 0,
  artists: 0,
  durationMs: 0,
  missing: 0,
};

@Injectable({ providedIn: 'root' })
export class LibraryStore {
  private readonly toasts = inject(ToastStore);
  private readonly playback = inject(PlaybackStore);

  readonly tracks = signal<Track[]>([]);
  readonly stats = signal<LibraryStats>({ ...EMPTY_STATS });
  readonly loading = signal(false);
  readonly importing = signal(false);
  readonly importProgress = signal<ImportProgress | null>(null);
  readonly loaded = signal(false);
  readonly lastImport = signal<ImportSummary | null>(null);

  private importProgressUnsubscribe: (() => void) | null = null;

  readonly isEmpty = computed(() => this.loaded() && this.tracks().length === 0);
  readonly albums = computed(() => {
    const map = new Map<string, { album: string; artist: string; artwork: string | null; tracks: number }>();
    for (const track of this.tracks()) {
      const key = `${track.album}::${track.albumArtist ?? track.artist}`;
      const existing = map.get(key);
      if (existing) {
        existing.tracks += 1;
        existing.artwork ??= track.artworkUrl;
      } else {
        map.set(key, {
          album: track.album,
          artist: track.albumArtist ?? track.artist,
          artwork: track.artworkUrl,
          tracks: 1,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
  });

  async init(): Promise<void> {
    if (this.loaded()) return;
    this.loading.set(true);
    try {
      const [tracks, stats] = await Promise.all([
        bridge().library.listTracks(),
        bridge().library.stats(),
      ]);
      this.tracks.set(tracks);
      this.stats.set(stats);
      this.loaded.set(true);
    } catch (error) {
      this.toasts.error('Could not load the library', String(error));
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<void> {
    try {
      const [tracks, stats] = await Promise.all([
        bridge().library.listTracks(),
        bridge().library.stats(),
      ]);
      this.tracks.set(tracks);
      this.stats.set(stats);
    } catch (error) {
      this.toasts.error('Could not refresh the library', String(error));
    }
  }

  async pickFiles(): Promise<void> {
    await this.runImport(() => bridge().library.pickFiles());
  }

  async pickFolder(): Promise<void> {
    await this.runImport(() => bridge().library.pickFolder());
  }

  async importDemo(): Promise<void> {
    await this.runImport(() => bridge().library.importDemoLibrary());
  }

  async importPaths(paths: string[]): Promise<ImportSummary | null> {
    return this.runImport(() => bridge().library.importPaths(paths));
  }

  async cancelImport(): Promise<void> {
    try {
      await bridge().library.cancelImport();
    } catch {
      // Cancellation is best-effort; the running import will resolve on its own.
    }
  }

  async removeTrack(track: Track): Promise<void> {
    try {
      const result = await bridge().library.removeTrack(track.id);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      if (result.value.removed) {
        this.toasts.success('Removed from library', track.title);
      }
      await this.refresh();
    } catch (error) {
      this.toasts.error('Could not remove the track', String(error));
    }
  }

  private async runImport(run: () => Promise<ImportSummary>): Promise<ImportSummary | null> {
    if (this.importing()) return null;
    this.importing.set(true);
    this.importProgress.set(null);
    this.ensureProgressSubscription();
    try {
      const summary = await run();
      this.lastImport.set(summary);
      await this.refresh();
      await this.announce(summary);
      return summary;
    } catch (error) {
      this.toasts.error('Import failed', String(error));
      return null;
    } finally {
      this.importing.set(false);
      this.importProgress.set(null);
    }
  }

  private ensureProgressSubscription(): void {
    if (this.importProgressUnsubscribe || !bridgeAvailable()) return;
    this.importProgressUnsubscribe = bridge().library.onImportProgress((progress) => {
      this.importProgress.set(progress);
    });
  }

  private async announce(summary: ImportSummary): Promise<void> {
    if (summary.cancelled) {
      this.toasts.push('Import cancelled');
      return;
    }
    const rejection = summary.rejected[0];
    const detailParts = [
      summary.duplicates > 0 ? `${summary.duplicates} already catalogued` : null,
      summary.missing > 0 ? `${summary.missing} missing` : null,
      summary.rejected.length > 0 ? `${summary.rejected.length} rejected` : null,
    ].filter((part): part is string => !!part);

    if (summary.imported > 0) {
      this.toasts.success(
        `Imported ${summary.imported} track${summary.imported === 1 ? '' : 's'}`,
        detailParts.join(' · ') || undefined,
      );
      if (this.playback.queue().entries.length === 0) {
        await this.playback.enqueue(summary.tracks.map((track) => track.id));
      }
      return;
    }
    if (summary.rejected.length > 0) {
      this.toasts.error(
        'No playable audio was found',
        rejection ? `${rejection.message} (${rejection.code})` : undefined,
      );
      return;
    }
    this.toasts.push('Nothing new to import', 'info', 'The selected audio is already catalogued.');
  }
}
