import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type {
  PodcastChangeEvent,
  PodcastDiscovery,
  PodcastDiscoveryCategory,
  PodcastEpisode,
  PodcastFeed,
  PodcastFeedPatch,
  PodcastSearchResult,
  Result,
} from '@statocyst/contracts';
import { fail, ok } from '@statocyst/contracts';
import { bridge } from './bridge';
import { ToastStore } from './toast.store';

const DISCOVERY_CACHE_KEY = 'statocyst.podcast.discovery.v1';
const SEARCH_CACHE_PREFIX = 'statocyst.podcast.search.v1.';
const DISCOVERY_TTL_MS = 30 * 60_000;
const SEARCH_TTL_MS = 15 * 60_000;
const ARTWORK_PREFETCH_LIMIT = 48;

function downscaleDirectoryArtwork(url: string): string {
  if (!/mzstatic\.com/i.test(url)) return url;
  return url.replace(/\/(\d+)x(\d+)bb\.(jpe?g|png)$/i, '/300x300bb.$3');
}

@Injectable({ providedIn: 'root' })
export class PodcastsStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly toasts = inject(ToastStore);
  private initialised = false;

  readonly feeds = signal<PodcastFeed[]>([]);
  readonly selectedFeedId = signal<string | null>(null);
  readonly episodes = signal<PodcastEpisode[]>([]);
  readonly continueListening = signal<PodcastEpisode[]>([]);
  readonly newEpisodes = signal<PodcastEpisode[]>([]);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly directoryConfigured = signal(false);
  readonly searchResults = signal<PodcastSearchResult[]>([]);
  readonly searching = signal(false);
  readonly discovery = signal<PodcastDiscovery | null>(null);
  readonly discoveryLoading = signal(false);
  readonly discoveryError = signal<string | null>(null);
  readonly activeCategory = signal<PodcastDiscoveryCategory | null>(null);
  readonly categoryResults = signal<PodcastSearchResult[]>([]);
  readonly categoryLoading = signal(false);
  readonly downloadPool = signal<PodcastEpisode[]>([]);
  readonly downloadPoolLoading = signal(false);
  private discoveryLoadedAt = 0;
  private readonly artworkRepairs = new Set<string>();
  private readonly artworkCache = new Map<string, string>();
  private readonly artworkPending = new Map<string, Promise<string | null>>();
  /** Last resume position mirrored from playback, used to avoid a write per tick. */
  private readonly progressWrites = new Map<string, number>();
  /** Every episode seen in a list, so a feed's view can be closed without losing the row. */
  private readonly knownEpisodes = new Map<string, PodcastEpisode>();
  readonly selectedFeed = computed(() => {
    const id = this.selectedFeedId();
    return id ? (this.feeds().find((feed) => feed.id === id) ?? null) : null;
  });
  readonly unplayedTotal = computed(() =>
    this.feeds().reduce((total, feed) => total + feed.unplayedCount, 0),
  );

  get available(): boolean {
    return !!bridge().podcast;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    const api = bridge().podcast;
    if (!api) return;
    this.destroyRef.onDestroy(api.onChanged((event) => this.handleChange(event)));
    await Promise.all([this.loadFeeds(), this.loadHome(), this.refreshDirectoryStatus()]);
    this.ready.set(true);
    void this.repairMissingArtworkFromSearch();
  }

  /** Best-effort cover repair for subscriptions that predate directory artwork. */
  private async repairMissingArtworkFromSearch(): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const missing = this.feeds()
      .filter((feed) => !feed.artworkUrl && !this.artworkRepairs.has(feed.id))
      .slice(0, 3);
    if (missing.length === 0) return;
    let changed = false;
    for (const feed of missing) {
      this.artworkRepairs.add(feed.id);
      try {
        const result = await api.searchDirectory(feed.title);
        if (!result.ok) {
          continue;
        }
        const match =
          result.value.find((entry) => entry.feedUrl === feed.feedUrl) ??
          result.value.find(
            (entry) => entry.title.trim().toLowerCase() === feed.title.trim().toLowerCase(),
          );
        if (!match?.artworkUrl) {
          continue;
        }
        const added = await api.addFeed(feed.feedUrl, { artworkUrl: match.artworkUrl });
        if (!added.ok) {
          continue;
        }
        this.feeds.update((list) =>
          list.map((entry) => (entry.id === added.value.id ? added.value : entry)),
        );
        changed = true;
      } catch {
        /* offline or provider failure: keep the fallback artwork */
      }
    }
    if (changed) {
      await this.loadHome();
      const selected = this.selectedFeedId();
      if (selected) await this.loadEpisodes(selected);
    }
  }

  async loadFeeds(): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    this.loading.set(true);
    try {
      const feeds = await api.listFeeds();
      this.feeds.set(feeds);
      this.error.set(null);
      const selected = this.selectedFeedId();
      if (selected && !feeds.some((feed) => feed.id === selected)) {
        this.selectedFeedId.set(null);
        this.episodes.set([]);
      }
    } catch (error) {
      this.error.set(String(error));
    } finally {
      this.loading.set(false);
    }
  }

  async loadHome(): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const feeds = this.feeds().length > 0 ? this.feeds() : await api.listFeeds();
    if (this.feeds().length === 0) this.feeds.set(feeds);
    try {
      const lists = await Promise.all(
        feeds.map((feed) =>
          api.listEpisodes(feed.id, { limit: 40, sort: 'newest' }).catch(() => []),
        ),
      );
      const all = lists.flat();
      this.rememberEpisodes(all);
      this.continueListening.set(
        all
          .filter((episode) => !episode.completed && episode.resumePositionMs > 0)
          .sort((a, b) =>
            (b.lastPlayedAt ?? b.publishedAt ?? '').localeCompare(
              a.lastPlayedAt ?? a.publishedAt ?? '',
            ),
          )
          .slice(0, 12),
      );
      this.newEpisodes.set(
        all
          .filter((episode) => !episode.played)
          .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
          .slice(0, 12),
      );
    } catch (error) {
      this.error.set(String(error));
    }
  }

  async selectFeed(feedId: string | null): Promise<void> {
    this.selectedFeedId.set(feedId);
    if (!feedId) {
      this.episodes.set([]);
      return;
    }
    await this.loadEpisodes(feedId);
  }

  /**
   * Re-read progress from the host. Playback does not emit a library change
   * event for every position tick, so a view that stays mounted (or is opened
   * again after listening) would otherwise keep the resume values from the
   * moment its lists were first loaded.
   */
  async refreshProgress(): Promise<void> {
    await this.loadHome();
    const selected = this.selectedFeedId();
    if (selected) await this.loadEpisodes(selected);
  }

  /**
   * Mirror the live playback position into the episode rows the UI renders.
   * This is intentionally coarse: the in-progress filter only needs to know a
   * position exists, and the continue card is fine with a five-second update.
   * `force` is used when playback pauses or ends so a short listen is visible.
   */
  notePlaybackProgress(
    trackId: string | null,
    positionMs: number,
    completed: boolean,
    force = false,
  ): void {
    if (!trackId) return;
    const position = Math.max(0, Math.round(positionMs));
    if (!completed && position <= 0) return;
    const previous = this.progressWrites.get(trackId) ?? -1;
    if (!completed && !force && Math.abs(position - previous) < 5_000) return;
    this.progressWrites.set(trackId, position);
    const apply = (episode: PodcastEpisode): PodcastEpisode => {
      if (episode.id !== trackId) return episode;
      const updated: PodcastEpisode = {
        ...episode,
        resumePositionMs: completed ? 0 : position,
        completed: episode.completed || completed,
        played: episode.played || completed,
      };
      this.knownEpisodes.set(trackId, updated);
      return updated;
    };
    this.episodes.update((list) => list.map(apply));
    this.continueListening.update((list) => {
      if (completed) return list.filter((episode) => episode.id !== trackId);
      if (list.some((episode) => episode.id === trackId)) return list.map(apply);
      // The feed view may already have been closed, so look the episode up in
      // the rows remembered from earlier lists rather than in `episodes()`.
      const episode =
        this.knownEpisodes.get(trackId) ?? this.episodes().find((row) => row.id === trackId);
      return episode ? [apply(episode), ...list].slice(0, 12) : list;
    });
    this.newEpisodes.update((list) =>
      completed
        ? list.filter((episode) => episode.id !== trackId)
        : list.map(apply),
    );
  }

  private rememberEpisodes(episodes: readonly PodcastEpisode[]): void {
    for (const episode of episodes) this.knownEpisodes.set(episode.id, episode);
  }

  async loadEpisodes(feedId: string): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const feed = this.feeds().find((candidate) => candidate.id === feedId);
    this.loading.set(true);
    try {
      const episodes = await api.listEpisodes(feedId, {
        sort: feed?.episodeSort ?? 'newest',
      });
      this.rememberEpisodes(episodes);
      this.episodes.set(episodes);
      this.error.set(null);
    } catch (error) {
      this.error.set(String(error));
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(feedId?: string): Promise<void> {
    const api = bridge().podcast;
    if (!api || this.refreshing()) return;
    this.refreshing.set(true);
    try {
      const summary = await api.refresh(feedId);
      if (summary.failed > 0) {
        this.toasts.error(
          'Some feeds could not refresh',
          summary.errors.map((entry) => entry.message).join(' · '),
        );
      } else {
        this.toasts.success(
          summary.feedId ? 'Feed refreshed' : 'Podcasts refreshed',
          summary.newEpisodes > 0
            ? `${summary.newEpisodes} new episode${summary.newEpisodes === 1 ? '' : 's'}`
            : `${summary.refreshed} feed${summary.refreshed === 1 ? '' : 's'} checked`,
        );
      }
      await this.loadFeeds();
      await this.loadHome();
      const selected = this.selectedFeedId();
      if (selected) await this.loadEpisodes(selected);
    } catch (error) {
      this.toasts.error('Could not refresh podcasts', String(error));
    } finally {
      this.refreshing.set(false);
    }
  }

  async addFeed(
    url: string,
    options: { select?: boolean; artworkUrl?: string | null } = {},
  ): Promise<boolean> {
    const api = bridge().podcast;
    if (!api) return false;
    this.loading.set(true);
    try {
      const result = await api.addFeed(url, { artworkUrl: options.artworkUrl ?? null });
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return false;
      }
      this.toasts.success('Subscribed', result.value.title);
      await this.loadFeeds();
      await this.loadHome();
      if (options.select !== false) await this.selectFeed(result.value.id);
      return true;
    } catch (error) {
      this.toasts.error('Could not add the podcast', String(error));
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  async updateFeed(feedId: string, patch: PodcastFeedPatch): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    try {
      const result = await api.updateFeed(feedId, patch);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      await this.loadFeeds();
      this.toasts.success('Show settings saved', result.value.title);
    } catch (error) {
      this.toasts.error('Could not save show settings', String(error));
    }
  }

  async removeFeed(feedId: string): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    try {
      const result = await api.removeFeed(feedId);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      if (this.selectedFeedId() === feedId) await this.selectFeed(null);
      await this.loadFeeds();
      await this.loadHome();
      this.toasts.push('Unsubscribed');
    } catch (error) {
      this.toasts.error('Could not remove the show', String(error));
    }
  }

  async setPlayed(episode: PodcastEpisode, played: boolean): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const result = await api.setPlayed(episode.episodeId, played);
    if (!result.ok) {
      this.toasts.error(result.error.message, result.error.code);
      return;
    }
    const update = (entry: PodcastEpisode): PodcastEpisode =>
      entry.episodeId === episode.episodeId ? result.value : entry;
    this.knownEpisodes.set(result.value.id, result.value);
    this.episodes.update((list) => list.map(update));
    this.continueListening.update((list) =>
      result.value.completed ? list.filter((entry) => entry.episodeId !== episode.episodeId) : list.map(update),
    );
    this.newEpisodes.update((list) =>
      result.value.played ? list.filter((entry) => entry.episodeId !== episode.episodeId) : list.map(update),
    );
    await this.loadFeeds();
  }

  async refreshDirectoryStatus(): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    try {
      this.directoryConfigured.set((await api.directoryStatus()).configured);
    } catch {
      this.directoryConfigured.set(false);
    }
  }

  clearSearch(): void {
    this.searchResults.set([]);
  }

  /**
   * Existing subscriptions imported before directory artwork was carried over
   * can be missing their cover. When a directory result for the same feed shows
   * up, cache its artwork once and re-save the feed so episode artwork follows.
   */
  private async repairMissingArtwork(
    candidates: readonly PodcastSearchResult[],
  ): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const byFeed = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate.artworkUrl) continue;
      byFeed.set(candidate.feedUrl, candidate.artworkUrl);
      byTitle.set(candidate.title.trim().toLowerCase(), candidate.artworkUrl);
    }
    const missing = this.feeds().filter(
      (feed) =>
        !feed.artworkUrl &&
        !this.artworkRepairs.has(feed.id) &&
        (byFeed.has(feed.feedUrl) || byTitle.has(feed.title.trim().toLowerCase())),
    );
    if (missing.length === 0) return;
    let changed = false;
    for (const feed of missing) {
      const artworkUrl =
        byFeed.get(feed.feedUrl) ?? byTitle.get(feed.title.trim().toLowerCase());
      if (!artworkUrl) continue;
      this.artworkRepairs.add(feed.id);
      try {
        const result = await api.addFeed(feed.feedUrl, { artworkUrl });
        if (!result.ok) continue;
        this.feeds.update((list) =>
          list.map((entry) => (entry.id === result.value.id ? result.value : entry)),
        );
        changed = true;
      } catch {
        /* keep the existing fallback artwork */
      }
    }
    if (changed) await this.loadHome();
  }

  /** Load the directory-driven landing page (top chart + categories). */
  async loadDiscovery(force = false): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    const fresh = Date.now() - this.discoveryLoadedAt < DISCOVERY_TTL_MS;
    if (!force && this.discovery() && fresh) {
      void this.cacheDiscoveryArtwork(this.discovery() as PodcastDiscovery);
      return;
    }
    if (!force) {
      const stored = this.readPersistent<PodcastDiscovery>(
        DISCOVERY_CACHE_KEY,
        DISCOVERY_TTL_MS,
      );
      if (stored) {
        this.discovery.set(stored);
        this.discoveryLoadedAt = Date.now();
        void this.cacheDiscoveryArtwork(stored);
        return;
      }
    }
    if (this.discoveryLoading()) return;
    this.discoveryLoading.set(true);
    this.discoveryError.set(null);
    try {
      const result = await api.discover();
      if (!result.ok) {
        if (!this.discovery()) this.discoveryError.set(result.error.message);
        return;
      }
      this.discovery.set(result.value);
      this.discoveryLoadedAt = Date.now();
      this.writePersistent(DISCOVERY_CACHE_KEY, result.value);
      void this.cacheDiscoveryArtwork(result.value);
      void this.repairMissingArtwork([
        ...result.value.top,
        ...result.value.shelves.flatMap((shelf) => shelf.shows),
      ]);
    } catch (error) {
      if (!this.discovery()) this.discoveryError.set(String(error));
    } finally {
      this.discoveryLoading.set(false);
    }
  }

  /** Browse one category by querying the directories with the category name. */
  async browseCategory(category: PodcastDiscoveryCategory): Promise<void> {
    this.activeCategory.set(category);
    this.categoryResults.set([]);
    this.categoryLoading.set(true);
    try {
      const result = await this.fetchDirectoryCached(category.name);
      if (!result.ok) {
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      this.categoryResults.set(result.value);
      void this.repairMissingArtwork(result.value);
      void this.cacheResultArtwork(result.value, (list) => {
        if (this.categoryResults() === result.value) this.categoryResults.set(list);
      });
    } catch (error) {
      this.toasts.error('Could not load that category', String(error));
    } finally {
      this.categoryLoading.set(false);
    }
  }

  /**
   * Directory responses are cached per query for 15 minutes. The host also
   * caches them, but this keeps mobile search instant across tab switches.
   */
  private async fetchDirectoryCached(
    query: string,
  ): Promise<Result<PodcastSearchResult[]>> {
    const trimmed = query.trim();
    if (!trimmed) return fail('INVALID_ARGUMENT', 'Search query must be 1–200 characters');
    const key = `${SEARCH_CACHE_PREFIX}${trimmed.toLowerCase()}`;
    const stored = this.readPersistent<PodcastSearchResult[]>(key, SEARCH_TTL_MS);
    if (stored) return ok(stored);
    const api = bridge().podcast;
    if (!api) return fail('ENGINE_UNAVAILABLE', 'Podcast discovery requires the desktop host');
    const result = await api.searchDirectory(trimmed);
    if (result.ok) {
      this.writePersistent(key, result.value);
      this.pruneSearchCache();
    }
    return result;
  }

  private async cacheDiscoveryArtwork(discovery: PodcastDiscovery): Promise<void> {
    const all = [...discovery.top, ...discovery.shelves.flatMap((shelf) => shelf.shows)];
    await this.prefetchArtwork(all.map((show) => show.artworkUrl));
    if (this.discovery() !== discovery) return;
    this.discovery.set({
      top: discovery.top.map((show) => this.remapArtwork(show)),
      categories: discovery.categories,
      shelves: discovery.shelves.map((shelf) => ({
        ...shelf,
        shows: shelf.shows.map((show) => this.remapArtwork(show)),
      })),
    });
  }

  private async cacheResultArtwork(
    results: readonly PodcastSearchResult[],
    apply: (list: PodcastSearchResult[]) => void,
  ): Promise<void> {
    await this.prefetchArtwork(results.map((result) => result.artworkUrl));
    apply(results.map((result) => this.remapArtwork(result)));
  }

  private remapArtwork(result: PodcastSearchResult): PodcastSearchResult {
    const cached = result.artworkUrl ? this.artworkCache.get(result.artworkUrl) : null;
    return cached ? { ...result, artworkUrl: cached } : result;
  }

  private async prefetchArtwork(urls: ReadonlyArray<string | null>): Promise<void> {
    const unique = [...new Set(urls.filter((url): url is string => Boolean(url)))].slice(
      0,
      ARTWORK_PREFETCH_LIMIT,
    );
    await Promise.all(unique.map((url) => this.cachedArtwork(url)));
  }

  private async cachedArtwork(url: string): Promise<string | null> {
    if (
      url.startsWith('statocyst-art:') ||
      url.startsWith('content:') ||
      /^http:\/\/127\.0\.0\.1:\d+\/__media\//.test(url)
    ) {
      this.artworkCache.set(url, url);
      return url;
    }
    const cached = this.artworkCache.get(url);
    if (cached) return cached;
    const pending = this.artworkPending.get(url);
    if (pending) return pending;
    const api = bridge().podcast;
    if (!api?.cacheArtwork) return null;
    const source = downscaleDirectoryArtwork(url);
    const promise = api
      .cacheArtwork(source)
      .then((result) => {
        this.artworkPending.delete(url);
        if (!result.ok || !result.value.url) return null;
        this.artworkCache.set(url, result.value.url);
        this.artworkCache.set(source, result.value.url);
        return result.value.url;
      })
      .catch(() => {
        this.artworkPending.delete(url);
        return null;
      });
    this.artworkPending.set(url, promise);
    return promise;
  }

  private readPersistent<T>(key: string, ttlMs: number): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { at?: unknown; value?: unknown };
      if (typeof parsed.at !== 'number' || Date.now() - parsed.at > ttlMs) return null;
      return (parsed.value as T) ?? null;
    } catch {
      return null;
    }
  }

  private writePersistent<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
    } catch {
      /* storage full or unavailable: the in-memory copy is still authoritative */
    }
  }

  private pruneSearchCache(): void {
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(SEARCH_CACHE_PREFIX)) keys.push(key);
      }
      for (const key of keys.slice(0, Math.max(0, keys.length - 24))) {
        localStorage.removeItem(key);
      }
    } catch {
      /* non-fatal */
    }
  }

  clearCategory(): void {
    this.activeCategory.set(null);
    this.categoryResults.set([]);
  }

  /** Load every subscribed episode so the Downloaded tab can filter verified pins. */
  async loadDownloadPool(force = false): Promise<void> {
    const api = bridge().podcast;
    if (!api) return;
    if (!force && this.downloadPool().length > 0) return;
    if (this.downloadPoolLoading()) return;
    this.downloadPoolLoading.set(true);
    try {
      const feeds = this.feeds().length > 0 ? this.feeds() : await api.listFeeds();
      const lists = await Promise.all(
        feeds.map((feed) =>
          api.listEpisodes(feed.id, { limit: 500 }).catch(() => [] as PodcastEpisode[]),
        ),
      );
      const pool = lists.flat();
      this.rememberEpisodes(pool);
      this.downloadPool.set(pool);
    } catch (error) {
      this.error.set(String(error));
    } finally {
      this.downloadPoolLoading.set(false);
    }
  }

  async search(query: string): Promise<void> {
    if (!query.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.searching.set(true);
    try {
      const result = await this.fetchDirectoryCached(query);
      if (!result.ok) {
        this.searchResults.set([]);
        this.toasts.error(result.error.message, result.error.code);
        return;
      }
      this.searchResults.set(result.value);
      void this.repairMissingArtwork(result.value);
      void this.cacheResultArtwork(result.value, (list) => {
        if (this.searchResults() === result.value) this.searchResults.set(list);
      });
    } catch (error) {
      this.toasts.error('Podcast search failed', String(error));
    } finally {
      this.searching.set(false);
    }
  }

  private handleChange(event: PodcastChangeEvent): void {
    void this.loadFeeds().then(() => {
      void this.loadHome();
      const selected = this.selectedFeedId();
      if (selected && (!event.feedId || event.feedId === selected)) {
        void this.loadEpisodes(selected);
      }
    });
  }
}
