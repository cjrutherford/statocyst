import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type {
  PodcastDiscoveryCategory,
  PodcastEpisode,
  PodcastDownloadVariant,
  PodcastFeed,
  PodcastSearchResult,
} from '@statocyst/contracts';
import { ArtworkComponent } from '../components/artwork.component';
import { IconComponent } from '../components/icon.component';
import { PodcastVideoStageComponent } from '../components/podcast-video-stage.component';
import { bridge } from '../core/bridge';
import { formatDuration } from '../core/format';
import { DownloadsStore } from '../core/downloads.store';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { PodcastsStore } from '../core/podcasts.store';
import { ScreenTransitionService } from '../core/screen-transition.service';
import { ToastStore } from '../core/toast.store';

type EpisodeFilter = 'all' | 'unplayed' | 'in-progress' | 'video';
type PodcastTab = 'subscribed' | 'downloaded' | 'discovery';

@Component({
  selector: 'sc-podcasts-view',
  standalone: true,
  imports: [ArtworkComponent, IconComponent, PodcastVideoStageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" aria-labelledby="podcasts-heading">
      <header class="view__head">
        <div class="view__intro">
          <p class="eyebrow">Bathypelagic radio</p>
          @if (store.selectedFeed(); as feed) {
            <button type="button" class="back" (click)="back()">
              <sc-icon name="previous" />
              <span>All podcasts</span>
            </button>
            <h1 id="podcasts-heading">{{ feed.title }}</h1>
            <p class="lede">{{ feed.author || 'Podcast' }} · {{ feed.unplayedCount }} unplayed</p>
          } @else {
            <h1 id="podcasts-heading">Podcasts</h1>
            <p class="lede">
              Discover shows through Apple Podcasts and Fyyd, then subscribe in one tap. Episodes
              stream, resume where you left off, and pin for offline listening.
            </p>
          }
        </div>
        <div class="actions">
          <button
            type="button"
            class="btn btn--quiet"
            [disabled]="store.refreshing() || store.discoveryLoading()"
            (click)="refreshCurrent()"
          >
            <sc-icon name="refresh" />
            {{ store.refreshing() || store.discoveryLoading() ? 'Refreshing…' : 'Refresh' }}
          </button>
          @if (!store.selectedFeed() && tab() !== 'discovery') {
            <button type="button" class="btn btn--primary" (click)="selectTab('discovery')">
              <sc-icon name="plus" />
              Discover
            </button>
          }
        </div>
      </header>

      @if (!store.available) {
        <div class="empty">
          <sc-icon name="wave" />
          <h2>Podcasts need the desktop host</h2>
          <p>Open Statocyst in Electron to subscribe and listen to podcasts.</p>
        </div>
      } @else {
        @if (store.error(); as error) {
          <div class="error-banner" role="alert">
            <sc-icon name="alert" />
            <span>{{ error }}</span>
            <button type="button" class="link-btn" (click)="store.loadFeeds()">Retry</button>
          </div>
        }

        <sc-podcast-video-stage />

        @if (store.selectedFeed(); as feed) {
          <section class="show" aria-labelledby="show-title">
            <div class="show__hero">
              <sc-artwork [src]="feed.artworkUrl" [altText]="feed.title" size="hero" />
              <div class="show__copy">
                <div class="show__actions">
                  <button
                    type="button"
                    class="btn btn--primary"
                    [disabled]="episodes().length === 0"
                    (click)="playLatest()"
                  >
                    <sc-icon name="play" />
                    Play latest
                  </button>
                  <button type="button" class="btn btn--quiet" (click)="store.refresh(feed.id)">
                    <sc-icon name="refresh" />
                    Refresh
                  </button>
                  <button type="button" class="btn btn--quiet" (click)="settingsOpen.set(!settingsOpen())">
                    <sc-icon name="settings" />
                    Show settings
                  </button>
                  <button type="button" class="btn btn--quiet danger" (click)="confirmRemove(feed)">
                    <sc-icon name="trash" />
                    {{ confirmingFeedId() === feed.id ? 'Confirm unsubscribe' : 'Unsubscribe' }}
                  </button>
                </div>
                <p class="show__description">{{ feed.descriptionText }}</p>
                <div class="show__stats">
                  <span>{{ feed.unplayedCount }} unplayed</span>
                  <span>{{ feed.episodeSort === 'newest' ? 'Newest first' : 'Oldest first' }}</span>
                  <span>{{ feed.defaultSpeed }}× default</span>
                  @if (feed.lastSuccessAt) {
                    <span>Updated {{ formatDate(feed.lastSuccessAt) }}</span>
                  }
                </div>
              </div>
            </div>

            @if (settingsOpen()) {
              <form class="panel show-settings" (submit)="$event.preventDefault()">
                <div class="settings-head">
                  <div>
                    <p class="eyebrow">Show defaults</p>
                    <h3>Playback & feed</h3>
                  </div>
                  <p class="hint">These defaults apply to new episodes from this show.</p>
                </div>
                <div class="settings-grid">
                  <label class="field">
                    <span class="field__label">Refresh every</span>
                    <select (change)="setInterval(feed, $event)">
                      <option value="15" [selected]="feed.refreshIntervalMinutes === 15">15 minutes</option>
                      <option value="30" [selected]="feed.refreshIntervalMinutes === 30">30 minutes</option>
                      <option value="60" [selected]="feed.refreshIntervalMinutes === 60">1 hour</option>
                      <option value="180" [selected]="feed.refreshIntervalMinutes === 180">3 hours</option>
                      <option value="720" [selected]="feed.refreshIntervalMinutes === 720">12 hours</option>
                      <option value="1440" [selected]="feed.refreshIntervalMinutes === 1440">1 day</option>
                    </select>
                    <span class="field__hint">How often Statocyst checks for new episodes.</span>
                  </label>
                  <label class="field">
                    <span class="field__label">Playback speed</span>
                    <select (change)="setSpeed(feed, $event)">
                      <option value="0.8" [selected]="feed.defaultSpeed === 0.8">0.8×</option>
                      <option value="1" [selected]="feed.defaultSpeed === 1">1×</option>
                      <option value="1.25" [selected]="feed.defaultSpeed === 1.25">1.25×</option>
                      <option value="1.5" [selected]="feed.defaultSpeed === 1.5">1.5×</option>
                      <option value="1.75" [selected]="feed.defaultSpeed === 1.75">1.75×</option>
                      <option value="2" [selected]="feed.defaultSpeed === 2">2×</option>
                    </select>
                    <span class="field__hint">Applied when this show starts playing.</span>
                  </label>
                  <label class="field">
                    <span class="field__label">Skip intro</span>
                    <select (change)="setSkip(feed, 'intro', $event)">
                      <option value="0" [selected]="feed.skipIntroSeconds === 0">Off</option>
                      <option value="15" [selected]="feed.skipIntroSeconds === 15">15 s</option>
                      <option value="30" [selected]="feed.skipIntroSeconds === 30">30 s</option>
                      <option value="45" [selected]="feed.skipIntroSeconds === 45">45 s</option>
                    </select>
                    <span class="field__hint">Manual skip button interval.</span>
                  </label>
                  <label class="field">
                    <span class="field__label">Skip outro</span>
                    <select (change)="setSkip(feed, 'outro', $event)">
                      <option value="0" [selected]="feed.skipOutroSeconds === 0">Off</option>
                      <option value="15" [selected]="feed.skipOutroSeconds === 15">15 s</option>
                      <option value="30" [selected]="feed.skipOutroSeconds === 30">30 s</option>
                      <option value="45" [selected]="feed.skipOutroSeconds === 45">45 s</option>
                    </select>
                    <span class="field__hint">Manual skip button interval.</span>
                  </label>
                  <label class="field">
                    <span class="field__label">Episode order</span>
                    <select [value]="feed.episodeSort" (change)="setSort(feed, $event)">
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                    <span class="field__hint">Used when seeding the podcast queue.</span>
                  </label>
                  <label class="field">
                    <span class="field__label">Preferred format</span>
                    <select
                      [value]="feed.defaultMediaForm || 'audio'"
                      (change)="setMediaForm(feed, $event)"
                    >
                      <option value="audio">Audio</option>
                      <option value="video">Video</option>
                    </select>
                    <span class="field__hint">Audio is the default when an episode has both.</span>
                  </label>
                </div>
                <label class="switch-row">
                  <input
                    type="checkbox"
                    [checked]="feed.autoQueue"
                    (change)="setAutoQueue(feed, $event)"
                  />
                  <span>
                    <span class="field__label">Auto-queue new episodes</span>
                    <span class="field__hint">Append the next episode when one finishes.</span>
                  </span>
                </label>
              </form>
            }

            <div class="episode-toolbar">
              <h2 id="show-title">Episodes</h2>
              <div class="filters" role="group" aria-label="Filter episodes">
                @for (option of filters; track option.id) {
                  <button
                    type="button"
                    class="chip-toggle"
                    [class.is-active]="filter() === option.id"
                    (click)="filter.set(option.id)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
              <label class="variant-picker">
                <span>Save as</span>
                <select
                  [value]="downloadVariant()"
                  (change)="setDownloadVariant($event)"
                  aria-label="Download format for pinned episodes"
                >
                  <option value="original">Original</option>
                  <option value="audio-only">Audio only</option>
                  <option value="video-480p">480p</option>
                  <option value="video-720p">720p</option>
                </select>
              </label>
            </div>

            @if (episodes().length === 0) {
              <div class="empty empty--compact">
                <sc-icon name="wave" />
                <p>No episodes yet. Refresh the show to pull the feed.</p>
              </div>
            } @else {
              <ul class="episode-list">
                @for (episode of episodes(); track episode.id) {
                  <li class="episode" [class.is-playing]="isCurrent(episode)">
                    <button
                      type="button"
                      class="episode__play"
                      [attr.aria-label]="isCurrent(episode) ? 'Pause episode' : 'Play episode'"
                      (click)="toggleEpisode(episode)"
                    >
                      <sc-icon [name]="isCurrent(episode) && playback.isPlaying() ? 'pause' : 'play'" />
                    </button>
                    <div class="episode__body">
                      <button type="button" class="episode__title" (click)="toggleNotes(episode)">
                        {{ episode.title }}
                        @if (episode.played) {
                          <sc-icon name="check" class="episode__played" />
                        }
                      </button>
                      <div class="episode__meta">
                        <span>{{ formatDate(episode.publishedAt) }}</span>
                        <span>{{ formatDuration(episode.durationMs) }}</span>
                        @if (episode.seasonNo || episode.episodeNo) {
                          <span>
                            @if (episode.seasonNo) { S{{ episode.seasonNo }} }
                            @if (episode.episodeNo) { E{{ episode.episodeNo }} }
                          </span>
                        }
                        @if (episode.explicit) {
                          <span class="explicit">Explicit</span>
                        }
                        @if (episode.mediaForm === 'video') {
                          <span class="explicit">Video</span>
                        }
                      </div>
                      @if (episode.resumePositionMs > 0 && !episode.completed) {
                        <div class="episode__progress" aria-hidden="true">
                          <span [style.width.%]="progressOf(episode)"></span>
                        </div>
                      }
                      @if (expanded() === episode.episodeId) {
                        <div class="episode__notes">
                          <p>{{ episode.descriptionText || 'No show notes for this episode.' }}</p>
                          @if (episode.links.length > 0) {
                            <div class="episode__links">
                              @for (link of episode.links; track link.url) {
                                <button type="button" class="link-btn" (click)="openLink(link.url)">
                                  <sc-icon name="external" />
                                  {{ link.title || link.url }}
                                </button>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                    <div class="episode__actions">
                      @if (downloads.supported) {
                        <button
                          type="button"
                          class="icon-btn"
                          [class.is-active]="downloads.isDownloaded()(episode.id)"
                          [disabled]="downloads.isDownloading()(episode.id)"
                          [attr.aria-label]="downloads.isDownloaded()(episode.id) ? 'Remove download' : 'Download episode'"
                          [title]="downloads.isDownloaded()(episode.id) ? 'Remove download' : 'Download episode'"
                          (click)="toggleDownload(episode)"
                        >
                          <sc-icon [name]="downloads.isDownloaded()(episode.id) ? 'check' : 'download'" />
                        </button>
                      }
                      <button
                        type="button"
                        class="icon-btn"
                        [attr.aria-label]="episode.played ? 'Mark unplayed' : 'Mark played'"
                        [title]="episode.played ? 'Mark unplayed' : 'Mark played'"
                        (click)="store.setPlayed(episode, !episode.played)"
                      >
                        <sc-icon [name]="episode.played ? 'refresh' : 'check'" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label="Add to podcast queue"
                        title="Add to queue"
                        (click)="enqueue(episode)"
                      >
                        <sc-icon name="queue" />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        [class.is-active]="expanded() === episode.episodeId"
                        aria-label="Show notes"
                        title="Show notes"
                        (click)="toggleNotes(episode)"
                      >
                        <sc-icon name="down" />
                      </button>
                    </div>
                  </li>
                }
              </ul>
            }
          </section>
        } @else {
          <nav class="podcast-tabs" role="tablist" aria-label="Podcast sections">
            @for (option of tabs; track option.id) {
              <button
                type="button"
                role="tab"
                class="podcast-tab"
                [id]="'podcast-tab-' + option.id"
                [class.is-active]="tab() === option.id"
                [attr.aria-selected]="tab() === option.id"
                [attr.tabindex]="tab() === option.id ? 0 : -1"
                (click)="selectTab(option.id)"
                (keydown)="onTabKey($event)"
              >
                {{ option.label }}
                @if (option.id === 'subscribed' && store.feeds().length > 0) {
                  <span class="podcast-tab__count">{{ store.feeds().length }}</span>
                }
                @if (option.id === 'downloaded' && downloadedEpisodes().length > 0) {
                  <span class="podcast-tab__count">{{ downloadedEpisodes().length }}</span>
                }
              </button>
            }
          </nav>

          @if (tab() === 'subscribed') {
          @if (store.continueListening().length > 0) {
            <section class="shelf" aria-labelledby="continue-heading">
              <div class="section-head">
                <h2 id="continue-heading">Continue listening</h2>
              </div>
              <div class="continue-grid">
                @for (episode of store.continueListening(); track episode.id) {
                  <article class="continue-card">
                    <button type="button" class="continue-card__play" (click)="toggleEpisode(episode)">
                      <sc-artwork [src]="episode.artworkUrl" [track]="episode" size="lg" />
                      <span class="continue-card__text">
                        <span class="continue-card__show">{{ episode.feedTitle }}</span>
                        <span class="continue-card__title">{{ episode.title }}</span>
                        <span class="continue-card__time">
                          {{ formatDuration(episode.resumePositionMs) }} /
                          {{ formatDuration(episode.durationMs) }}
                        </span>
                      </span>
                    </button>
                    <div class="continue-card__progress" aria-hidden="true">
                      <span [style.width.%]="progressOf(episode)"></span>
                    </div>
                  </article>
                }
              </div>
            </section>
          }

          @if (store.newEpisodes().length > 0) {
            <section class="shelf" aria-labelledby="new-heading">
              <div class="section-head">
                <h2 id="new-heading">New episodes</h2>
                <button type="button" class="link-btn" (click)="store.refresh()">
                  Refresh all
                </button>
              </div>
              <ul class="new-list">
                @for (episode of store.newEpisodes(); track episode.id) {
                  <li>
                    <button type="button" class="new-row" (click)="openFeed(episode.feedId)">
                      <sc-artwork [src]="episode.artworkUrl" [track]="episode" size="sm" />
                      <span class="new-row__text">
                        <span class="new-row__show">{{ episode.feedTitle }}</span>
                        <span class="new-row__title">{{ episode.title }}</span>
                      </span>
                      <span class="new-row__date">{{ formatDate(episode.publishedAt) }}</span>
                    </button>
                  </li>
                }
              </ul>
            </section>
          }

          <section class="shelf" aria-labelledby="subscriptions-heading">
            <div class="section-head">
              <h2 id="subscriptions-heading">Subscriptions</h2>
              <span class="count">{{ store.feeds().length }}</span>
            </div>
            @if (store.feeds().length === 0 && !store.loading()) {
              <div class="empty">
                <sc-icon name="wave" />
                <h3>No subscriptions yet</h3>
                <p>Search Apple Podcasts or Fyyd to find a show and subscribe in one tap.</p>
                <button type="button" class="btn btn--primary" (click)="selectTab('discovery')">
                  <sc-icon name="plus" />
                  Add your first podcast
                </button>
              </div>
            } @else {
              <div class="feed-grid">
                @for (feed of store.feeds(); track feed.id; let i = $index) {
                  <article class="feed-card" [style.--i]="i">
                    <button type="button" class="feed-card__main" (click)="openFeed(feed.id)">
                      <sc-artwork [src]="feed.artworkUrl" [altText]="feed.title" size="hero" />
                      <span class="feed-card__body">
                        <span class="feed-card__title">{{ feed.title }}</span>
                        <span class="feed-card__author">{{ feed.author || 'Podcast' }}</span>
                        <span class="feed-card__meta">
                          @if (feed.unplayedCount > 0) {
                            <span class="badge">{{ feed.unplayedCount }} unplayed</span>
                          }
                          @if (feed.fetchError) {
                            <span class="badge badge--error">Feed error</span>
                          }
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="feed-card__refresh"
                      aria-label="Refresh show"
                      title="Refresh show"
                      (click)="store.refresh(feed.id)"
                    >
                      <sc-icon name="refresh" />
                    </button>
                  </article>
                }
              </div>
            }
          </section>
          }

          @if (tab() === 'downloaded') {
            <section class="shelf" aria-labelledby="downloaded-heading">
              <div class="section-head">
                <h2 id="downloaded-heading">Downloaded episodes</h2>
                <span class="count">{{ downloadedEpisodes().length }}</span>
              </div>
              @if (store.downloadPoolLoading()) {
                <p class="hint" role="status">Loading downloads…</p>
              } @else if (!downloads.supported) {
                <div class="empty empty--compact">
                  <sc-icon name="download" />
                  <p>Offline downloads are not available in this runtime.</p>
                </div>
              } @else if (downloadedEpisodes().length === 0) {
                <div class="empty empty--compact">
                  <sc-icon name="download" />
                  <p>No downloaded episodes yet. Pin an episode from a show to listen offline.</p>
                  <button type="button" class="btn btn--primary" (click)="selectTab('discovery')">
                    Discover podcasts
                  </button>
                </div>
              } @else {
                <ul class="episode-list">
                  @for (episode of downloadedEpisodes(); track episode.id) {
                    <li class="episode" [class.is-playing]="isCurrent(episode)">
                      <button
                        type="button"
                        class="episode__play"
                        [attr.aria-label]="isCurrent(episode) ? 'Pause episode' : 'Play episode'"
                        (click)="toggleEpisode(episode)"
                      >
                        <sc-icon [name]="isCurrent(episode) && playback.isPlaying() ? 'pause' : 'play'" />
                      </button>
                      <div class="episode__body">
                        <button type="button" class="episode__title" (click)="openFeed(episode.feedId)">
                          {{ episode.title }}
                        </button>
                        <div class="episode__meta">
                          <span>{{ episode.feedTitle }}</span>
                          <span>{{ formatDate(episode.publishedAt) }}</span>
                          <span>{{ formatDuration(episode.durationMs) }}</span>
                        </div>
                      </div>
                      <div class="episode__actions">
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Remove download"
                          title="Remove download"
                          (click)="toggleDownload(episode)"
                        >
                          <sc-icon name="trash" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          [attr.aria-label]="episode.played ? 'Mark unplayed' : 'Mark played'"
                          [title]="episode.played ? 'Mark unplayed' : 'Mark played'"
                          (click)="store.setPlayed(episode, !episode.played)"
                        >
                          <sc-icon [name]="episode.played ? 'refresh' : 'check'" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          aria-label="Open show"
                          title="Open show"
                          (click)="openFeed(episode.feedId)"
                        >
                          <sc-icon name="external" />
                        </button>
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>
          }

          @if (tab() === 'discovery') {
            <section class="discovery" aria-labelledby="discovery-heading">
              <div class="discovery-hero">
                <div class="discovery-hero__copy">
                  <p class="eyebrow">Open podcast directory</p>
                  <h2 id="discovery-heading">Find your next listen</h2>
                  <p class="discovery-hero__lede">
                    Search Apple Podcasts and Fyyd, or start with a show the directories are
                    surfacing right now. No account, feed URL or API key required.
                  </p>
                  <form class="search-shell" (submit)="submitSearch($event)">
                    <sc-icon name="search" class="search-shell__icon" />
                    <label class="visually-hidden" for="podcast-search">Search podcasts</label>
                    <input
                      id="podcast-search"
                      type="search"
                      autocomplete="off"
                      placeholder="Search shows, hosts, or topics"
                      [value]="searchQuery()"
                      (input)="searchQuery.set(value($event))"
                    />
                    @if (searchQuery()) {
                      <button
                        type="button"
                        class="search-shell__clear"
                        aria-label="Clear search"
                        (click)="clearSearch()"
                      >
                        <sc-icon name="close" />
                      </button>
                    }
                    <button type="submit" class="btn btn--primary" [disabled]="store.searching()">
                      {{ store.searching() ? 'Searching…' : 'Search' }}
                    </button>
                  </form>
                  <div class="discovery-hints">
                    <span><sc-icon name="wave" /> Apple Podcasts + Fyyd</span>
                    <span>No setup</span>
                    <span>Subscribe in one tap</span>
                  </div>
                </div>

                @if (store.discovery(); as heroDiscovery) {
                  @if (heroDiscovery.top[0]; as featured) {
                    <article class="featured-pick">
                      <sc-artwork
                        class="featured-pick__art"
                        [src]="featured.artworkUrl"
                        [altText]="featured.title"
                        size="hero"
                      />
                      <div class="featured-pick__body">
                        <p class="eyebrow">Featured right now</p>
                        <h3>{{ featured.title }}</h3>
                        <p class="featured-pick__author">{{ featured.author || 'Podcast' }}</p>
                        @if (featured.descriptionText) {
                          <p class="featured-pick__desc">{{ featured.descriptionText }}</p>
                        }
                        <button
                          type="button"
                          class="btn btn--quiet"
                          [disabled]="isSubscribed(featured)"
                          (click)="subscribeResult(featured)"
                        >
                          {{ isSubscribed(featured) ? 'Subscribed' : 'Subscribe' }}
                        </button>
                      </div>
                    </article>
                  }
                }
              </div>

              @if (store.searching()) {
                <div class="skeleton-grid" role="status" aria-label="Searching podcast directories">
                  @for (i of [0, 1, 2]; track i) {
                    <div class="skeleton-card" aria-hidden="true">
                      <span class="skeleton skeleton--art"></span>
                      <span class="skeleton skeleton--line"></span>
                      <span class="skeleton skeleton--line skeleton--short"></span>
                    </div>
                  }
                </div>
              } @else if (store.searchResults().length > 0) {
                <div class="section-head">
                  <h2>Search results</h2>
                  <div class="section-head__actions">
                    <span class="count">{{ store.searchResults().length }}</span>
                    <button type="button" class="link-btn" (click)="clearSearch()">
                      Back to discovery
                    </button>
                  </div>
                </div>
                <div class="result-grid">
                  @for (result of store.searchResults(); track result.feedUrl; let i = $index) {
                    <article class="result" [style.--i]="i">
                      <sc-artwork [src]="result.artworkUrl" [altText]="result.title" size="md" />
                      <div class="result__meta">
                        <div class="result__title-row">
                          <h3>{{ result.title }}</h3>
                          <span class="source-badge">{{ sourceLabel(result.source) }}</span>
                        </div>
                        <p class="result__author">{{ result.author || 'Unknown author' }}</p>
                        @if (result.descriptionText) {
                          <p class="result__description">{{ result.descriptionText }}</p>
                        }
                      </div>
                      <button
                        type="button"
                        class="btn btn--quiet result__action"
                        [disabled]="isSubscribed(result)"
                        (click)="subscribeResult(result)"
                      >
                        {{ isSubscribed(result) ? 'Subscribed' : 'Subscribe' }}
                      </button>
                    </article>
                  }
                </div>
              } @else if (hasSearched()) {
                <div class="empty empty--compact">
                  <sc-icon name="search" />
                  <p>No shows matched that search. Try a different title or topic.</p>
                  <button type="button" class="btn btn--quiet" (click)="clearSearch()">
                    Back to discovery
                  </button>
                </div>
              } @else if (store.discoveryLoading() && !store.discovery()) {
                <div class="skeleton-grid" role="status" aria-label="Loading podcast discovery">
                  @for (i of [0, 1, 2]; track i) {
                    <div class="skeleton-card" aria-hidden="true">
                      <span class="skeleton skeleton--art"></span>
                      <span class="skeleton skeleton--line"></span>
                      <span class="skeleton skeleton--line skeleton--short"></span>
                    </div>
                  }
                </div>
              } @else if (store.discoveryError(); as error) {
                <div class="error-banner" role="alert">
                  <sc-icon name="alert" />
                  <span>{{ error }}</span>
                  <button type="button" class="link-btn" (click)="store.loadDiscovery(true)">
                    Retry
                  </button>
                </div>
              } @else if (store.discovery(); as discovery) {
                @if (store.activeCategory(); as category) {
                  <div class="section-head discovery-section-head">
                    <div class="section-head__title">
                      <button type="button" class="back" (click)="store.clearCategory()">
                        <sc-icon name="previous" />
                        <span>All categories</span>
                      </button>
                      <h2>{{ category.name }}</h2>
                    </div>
                    <span class="count">{{ store.categoryResults().length }} shows</span>
                  </div>
                  @if (store.categoryLoading()) {
                    <div class="skeleton-grid" role="status" aria-label="Loading category shows">
                      @for (i of [0, 1, 2]; track i) {
                        <div class="skeleton-card" aria-hidden="true">
                          <span class="skeleton skeleton--art"></span>
                          <span class="skeleton skeleton--line"></span>
                          <span class="skeleton skeleton--line skeleton--short"></span>
                        </div>
                      }
                    </div>
                  } @else if (store.categoryResults().length === 0) {
                    <div class="empty empty--compact">
                      <sc-icon name="search" />
                      <p>No {{ category.name }} shows came back from the directories.</p>
                    </div>
                  } @else {
                    <div class="result-grid">
                      @for (result of store.categoryResults(); track result.feedUrl; let i = $index) {
                        <article class="result" [style.--i]="i">
                          <sc-artwork [src]="result.artworkUrl" [altText]="result.title" size="md" />
                          <div class="result__meta">
                            <div class="result__title-row">
                              <h3>{{ result.title }}</h3>
                              <span class="source-badge">{{ sourceLabel(result.source) }}</span>
                            </div>
                            <p class="result__author">{{ result.author || 'Unknown author' }}</p>
                            @if (result.descriptionText) {
                              <p class="result__description">{{ result.descriptionText }}</p>
                            }
                          </div>
                          <button
                            type="button"
                            class="btn btn--quiet result__action"
                            [disabled]="isSubscribed(result)"
                            (click)="subscribeResult(result)"
                          >
                            {{ isSubscribed(result) ? 'Subscribed' : 'Subscribe' }}
                          </button>
                        </article>
                      }
                    </div>
                  }
                } @else {
                  @if (recommendedShows().length > 0) {
                    <section class="shelf" aria-labelledby="recommended-heading">
                      <div class="section-head discovery-section-head">
                        <div>
                          <h2 id="recommended-heading">Recommended for you</h2>
                          <p class="section-subtitle">{{ recommendedLabel() }}</p>
                        </div>
                        <span class="count">{{ recommendedShows().length }} picks</span>
                      </div>
                      <div class="recommendation-grid">
                        @for (show of recommendedShows(); track show.feedUrl; let i = $index) {
                          <article class="recommendation-card" [style.--i]="i">
                            <sc-artwork [src]="show.artworkUrl" [altText]="show.title" size="hero" />
                            <div class="recommendation-card__body">
                              <h3>{{ show.title }}</h3>
                              <p>{{ show.author || 'Podcast' }}</p>
                              <span class="source-badge">{{ sourceLabel(show.source) }}</span>
                            </div>
                            <button
                              type="button"
                              class="btn btn--quiet"
                              [disabled]="isSubscribed(show)"
                              (click)="subscribeResult(show)"
                            >
                              {{ isSubscribed(show) ? 'Subscribed' : 'Subscribe' }}
                            </button>
                          </article>
                        }
                      </div>
                    </section>
                  }

                  @if (discovery.top.length > 0) {
                    <section class="shelf" aria-labelledby="top-heading">
                      <div class="section-head discovery-section-head">
                        <div>
                          <h2 id="top-heading">Popular this week</h2>
                          <p class="section-subtitle">The directory's current top chart</p>
                        </div>
                        <span class="count">{{ discovery.top.length }} shows</span>
                      </div>
                      <div class="top-grid">
                        @for (show of discovery.top; track show.feedUrl; let index = $index) {
                          <article class="top-card" [style.--i]="index">
                            <span class="top-card__rank">{{ index + 1 }}</span>
                            <sc-artwork [src]="show.artworkUrl" [altText]="show.title" size="hero" />
                            <div class="top-card__body">
                              <h3>{{ show.title }}</h3>
                              <p>{{ show.author || 'Podcast' }}</p>
                              <span class="source-badge">{{ sourceLabel(show.source) }}</span>
                            </div>
                            <button
                              type="button"
                              class="btn btn--quiet"
                              [disabled]="isSubscribed(show)"
                              (click)="subscribeResult(show)"
                            >
                              {{ isSubscribed(show) ? 'Subscribed' : 'Subscribe' }}
                            </button>
                          </article>
                        }
                      </div>
                    </section>
                  }

                  @if (discovery.categories.length > 0) {
                    <section class="shelf" aria-labelledby="categories-heading">
                      <div class="section-head discovery-section-head">
                        <div>
                          <h2 id="categories-heading">Browse by category</h2>
                          <p class="section-subtitle">Explore the shape of the directory</p>
                        </div>
                        <span class="count">{{ discovery.categories.length }}</span>
                      </div>
                      <div class="category-grid">
                        @for (category of discovery.categories; track category.id; let i = $index) {
                          <button
                            type="button"
                            class="category-card"
                            [style.--i]="i"
                            (click)="browseCategory(category)"
                          >
                            <span class="category-card__icon"><sc-icon name="wave" /></span>
                            <span class="category-card__name">{{ category.name }}</span>
                            <span class="category-card__count">{{ category.count }} top shows</span>
                          </button>
                        }
                      </div>
                    </section>
                  }

                  @for (shelf of discovery.shelves; track shelf.category.id) {
                    <section class="shelf">
                      <div class="section-head discovery-section-head">
                        <h2>{{ shelf.category.name }}</h2>
                        <button
                          type="button"
                          class="link-btn"
                          (click)="browseCategory(shelf.category)"
                        >
                          See all
                        </button>
                      </div>
                      <div class="show-row">
                        @for (show of shelf.shows; track show.feedUrl; let i = $index) {
                          <article class="show-tile" [style.--i]="i">
                            <sc-artwork [src]="show.artworkUrl" [altText]="show.title" size="hero" />
                            <div class="show-tile__body">
                              <h3>{{ show.title }}</h3>
                              <p>{{ show.author || 'Podcast' }}</p>
                              <span class="source-badge">{{ sourceLabel(show.source) }}</span>
                            </div>
                            <button
                              type="button"
                              class="btn btn--quiet"
                              [disabled]="isSubscribed(show)"
                              (click)="subscribeResult(show)"
                            >
                              {{ isSubscribed(show) ? 'Subscribed' : 'Subscribe' }}
                            </button>
                          </article>
                        }
                      </div>
                    </section>
                  }
                }
              }
            </section>
          }
        }
      }
    </section>
  `,
  styles: [
    `
      .view {
        display: grid;
        gap: clamp(18px, 2.4vw, 32px);
        padding: clamp(20px, 3vw, 40px);
        max-width: 1480px;
        margin: 0 auto;
        animation: rise 380ms ease both;
      }
      .view__head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-end;
        gap: 18px;
      }
      .view__intro {
        display: grid;
        gap: 4px;
        max-width: 760px;
      }
      .eyebrow {
        margin: 0;
        color: var(--cyan);
        font-size: 0.68rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 2px 0 4px;
        font-size: clamp(2rem, 3.5vw, 3.2rem);
        letter-spacing: -0.035em;
      }
      h2 {
        margin: 0;
        font-size: 1.1rem;
        letter-spacing: -0.01em;
      }
      h3 {
        margin: 0;
      }
      .lede {
        margin: 0;
        color: var(--muted);
        max-width: 62ch;
        line-height: 1.55;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .actions .btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .podcast-tabs {
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        justify-self: start;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--surface-1);
      }
      .podcast-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: var(--muted);
        padding: 7px 16px;
        font: inherit;
        font-size: 0.82rem;
        cursor: pointer;
      }
      .podcast-tab:hover {
        color: var(--text);
      }
      .podcast-tab.is-active {
        background: var(--surface-row-hover);
        color: var(--text);
        box-shadow: inset 0 0 0 1px var(--line-strong);
      }
      .podcast-tab__count {
        padding: 0 6px;
        border-radius: 999px;
        background: rgba(56, 225, 255, 0.14);
        color: var(--cyan);
        font-size: 0.66rem;
      }
      .discovery {
        display: grid;
        gap: clamp(16px, 2vw, 26px);
      }
      .discovery__head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
      }
      .discovery__intro {
        display: grid;
        gap: 4px;
        max-width: 70ch;
      }
      .discovery-search {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .discovery-search input {
        min-width: min(320px, 68vw);
      }
      .section-head__title,
      .section-head__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .result-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 8px;
      }
      .top-grid,
      .show-row {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(150px, 170px);
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 6px;
        scroll-snap-type: x proximity;
      }
      .top-card,
      .show-tile {
        position: relative;
        display: grid;
        gap: 6px;
        align-content: start;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-1);
        scroll-snap-align: start;
      }
      .top-card h3,
      .show-tile h3 {
        font-size: 0.86rem;
        line-height: 1.25;
      }
      .top-card p,
      .show-tile p {
        margin: 0;
        color: var(--muted);
        font-size: 0.74rem;
        line-height: 1.35;
      }
      .top-card .btn,
      .show-tile .btn {
        justify-self: start;
        margin-top: 2px;
      }
      .top-card__rank {
        position: absolute;
        top: 14px;
        left: 14px;
        z-index: 1;
        min-width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        padding: 0 5px;
        border-radius: 999px;
        background: rgba(4, 12, 20, 0.82);
        color: var(--cyan);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
      }
      .category-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 8px;
      }
      .category-card {
        display: grid;
        gap: 2px;
        text-align: left;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--surface-1);
        color: var(--text);
        font: inherit;
        cursor: pointer;
      }
      .category-card:hover {
        border-color: var(--line-strong);
        background: var(--surface-row-hover);
      }
      .category-card__name {
        font-size: 0.86rem;
      }
      .category-card__count {
        color: var(--muted-dim);
        font-size: 0.7rem;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .back {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        justify-self: start;
        border: 0;
        background: transparent;
        color: var(--muted);
        padding: 0;
        margin-bottom: 4px;
        font: inherit;
        font-size: 0.78rem;
        cursor: pointer;
      }
      .back:hover {
        color: var(--text);
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-2);
        box-shadow: var(--shadow);
      }
      .add-panel {
        display: grid;
        gap: 14px;
        padding: clamp(14px, 2vw, 22px);
      }
      .add-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }
      .add-form,
      .discovery-form {
        display: grid;
        gap: 7px;
        align-content: start;
      }
      .discovery-form label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }
      .genre-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 2px;
      }
      .source-badge {
        display: inline-block;
        margin-left: 6px;
        padding: 0 6px;
        border-radius: 999px;
        border: 1px solid var(--line-strong);
        color: var(--muted);
        font-size: 0.62rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .add-form label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .field-row input {
        flex: 1 1 180px;
        min-width: 0;
      }
      .hint {
        margin: 0;
        color: var(--muted-dim);
        font-size: 0.76rem;
        line-height: 1.45;
      }
      .creds {
        display: grid;
        gap: 8px;
        padding-top: 12px;
        border-top: 1px solid var(--line);
      }
      .search-results {
        display: grid;
        gap: 8px;
      }
      .result {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--surface-1);
      }
      .result__meta {
        display: grid;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .result__meta p {
        margin: 0;
        color: var(--muted);
        font-size: 0.78rem;
      }
      .result__description {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .error-banner {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 14px;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(255, 107, 138, 0.35);
        background: rgba(255, 107, 138, 0.08);
        color: var(--danger);
        font-size: 0.82rem;
      }
      .error-banner span {
        flex: 1;
      }
      .show {
        display: grid;
        gap: 18px;
      }
      .show__hero {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
        gap: clamp(16px, 3vw, 30px);
        align-items: end;
      }
      .show__copy {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .show__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .show__actions .btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .show__description {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
        max-width: 78ch;
      }
      .show__stats {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        color: var(--muted-dim);
        font-size: 0.76rem;
      }
      .show-settings {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
        padding: 16px;
      }
      .show-settings label {
        display: grid;
        gap: 5px;
        font-size: 0.72rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .show-settings select {
        min-height: 36px;
      }
      .show-settings .check {
        display: flex;
        align-items: center;
        gap: 8px;
        text-transform: none;
        letter-spacing: 0;
        font-size: 0.8rem;
      }
      .episode-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .filters {
        display: flex;
        gap: 6px;
      }
      .variant-picker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.75rem;
        color: var(--muted);
      }
      .variant-picker select {
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--text);
        font: inherit;
      }
      .episode-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 4px;
      }
      .episode {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
        padding: 10px 8px;
        border-radius: var(--radius-sm);
        border: 1px solid transparent;
      }
      .episode:hover {
        background: var(--surface-row-hover);
        border-color: var(--line);
      }
      .episode.is-playing {
        background: rgba(56, 225, 255, 0.055);
        border-color: rgba(56, 225, 255, 0.22);
      }
      .episode__play {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid var(--line-strong);
        background: var(--surface-1);
        color: var(--text);
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .episode.is-playing .episode__play {
        color: var(--on-accent);
        background: var(--cyan);
        border-color: transparent;
      }
      .episode__body {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .episode__title {
        justify-self: start;
        border: 0;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-weight: 600;
        text-align: left;
        padding: 0;
        cursor: pointer;
      }
      .episode__title:hover {
        color: var(--cyan);
      }
      .episode__played {
        color: var(--success);
        margin-left: 6px;
      }
      .episode__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted-dim);
        font-size: 0.74rem;
      }
      .explicit {
        border: 1px solid var(--line-strong);
        border-radius: 4px;
        padding: 0 4px;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .episode__progress,
      .continue-card__progress {
        height: 3px;
        border-radius: 999px;
        background: var(--line);
        overflow: hidden;
        margin-top: 3px;
      }
      .episode__progress span,
      .continue-card__progress span {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--cyan), var(--violet));
      }
      .episode__notes {
        margin-top: 8px;
        padding: 10px 12px;
        border-left: 2px solid var(--line-strong);
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.55;
        white-space: pre-wrap;
      }
      .episode__notes p {
        margin: 0;
      }
      .episode__links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 8px;
      }
      .episode__actions {
        display: flex;
        gap: 2px;
      }
      .shelf {
        display: grid;
        gap: 12px;
      }
      .section-head {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
      }
      .count {
        color: var(--muted);
        font-size: 0.78rem;
      }
      .continue-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 10px;
      }
      .continue-card {
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--surface-1);
        padding: 10px;
      }
      .continue-card__play {
        display: flex;
        gap: 10px;
        align-items: center;
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        font: inherit;
        width: 100%;
        cursor: pointer;
      }
      .continue-card__text {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .continue-card__show,
      .new-row__show {
        color: var(--cyan);
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
      }
      .continue-card__title,
      .new-row__title {
        font-size: 0.84rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .continue-card__time {
        color: var(--muted-dim);
        font-size: 0.72rem;
      }
      .new-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }
      .new-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        padding: 7px 8px;
        cursor: pointer;
      }
      .new-row:hover {
        background: var(--surface-row-hover);
      }
      .new-row__text {
        display: grid;
        gap: 1px;
        min-width: 0;
        flex: 1;
      }
      .new-row__date {
        color: var(--muted-dim);
        font-size: 0.72rem;
      }
      .feed-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 12px;
      }
      .feed-card {
        position: relative;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-1);
        overflow: hidden;
      }
      .feed-card__main {
        display: grid;
        gap: 8px;
        width: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        padding: 10px 10px 12px;
        cursor: pointer;
      }
      .feed-card__main:hover {
        background: var(--surface-row-hover);
      }
      .feed-card__body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .feed-card__title {
        font-weight: 600;
        font-size: 0.88rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .feed-card__author {
        color: var(--muted);
        font-size: 0.76rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .feed-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 3px;
      }
      .badge {
        border-radius: 999px;
        padding: 1px 7px;
        border: 1px solid rgba(56, 225, 255, 0.28);
        background: rgba(56, 225, 255, 0.08);
        color: var(--cyan);
        font-size: 0.64rem;
      }
      .badge--error {
        border-color: rgba(255, 107, 138, 0.35);
        background: rgba(255, 107, 138, 0.08);
        color: var(--danger);
      }
      .feed-card__refresh {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid var(--line);
        background: rgba(3, 7, 15, 0.6);
        color: var(--text);
        display: grid;
        place-items: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 140ms ease;
      }
      .feed-card:hover .feed-card__refresh,
      .feed-card__refresh:focus-visible {
        opacity: 1;
      }
      .empty {
        display: grid;
        justify-items: center;
        gap: 8px;
        text-align: center;
        padding: clamp(28px, 6vw, 60px) 20px;
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius);
        color: var(--muted);
        background: var(--surface-3);
      }
      .empty sc-icon {
        font-size: 2rem;
        color: var(--cyan);
      }
      .empty h2,
      .empty h3 {
        color: var(--text);
      }
      .empty p {
        margin: 0;
        max-width: 46ch;
      }
      .empty--compact {
        padding: 22px;
      }
      .danger {
        color: var(--danger);
      }
      .link-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 0;
        background: transparent;
        color: var(--cyan);
        font: inherit;
        font-size: 0.78rem;
        padding: 0;
        cursor: pointer;
      }
      .link-btn:hover {
        color: var(--cyan-soft);
        text-decoration: underline;
      }
      .is-active {
        color: var(--cyan);
      }
      .view > .shelf,
      .view > .discovery {
        animation: rise var(--motion-deep) ease both;
      }
      .view > .shelf:nth-of-type(2),
      .view > .discovery:nth-of-type(2) {
        animation-delay: 40ms;
      }
      .view > .shelf:nth-of-type(3) {
        animation-delay: 80ms;
      }
      .podcast-tabs {
        animation: rise var(--motion-deep) ease both;
      }
      .podcast-tab {
        transition:
          color var(--motion-quick) ease,
          background var(--motion-quick) ease,
          box-shadow var(--motion-quick) ease;
      }
      .feed-card,
      .result,
      .top-card,
      .show-tile,
      .category-card {
        animation: card-in 460ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
        animation-delay: min(calc(var(--i, 0) * 24ms), 480ms);
        transition:
          border-color var(--motion-quick) ease,
          background var(--motion-quick) ease,
          transform 200ms var(--ease-tide),
          box-shadow 200ms var(--ease-tide);
      }
      .feed-card:hover,
      .result:hover,
      .top-card:hover,
      .show-tile:hover,
      .category-card:hover {
        border-color: var(--line-strong);
        transform: translateY(-2px);
      }
      .top-card sc-artwork,
      .show-tile sc-artwork {
        transition: transform 300ms var(--ease-tide);
      }
      .top-card:hover sc-artwork,
      .show-tile:hover sc-artwork {
        transform: scale(1.02);
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.995);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(14px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (max-width: 760px) {
        .view {
          padding: 16px;
        }
        .view__head {
          align-items: stretch;
        }
        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .actions .btn:last-child {
          grid-column: 1 / -1;
        }
        .show__hero {
          grid-template-columns: 1fr;
        }
        .show__hero sc-artwork {
          max-width: 180px;
        }
        .episode {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .episode__actions {
          grid-column: 2;
          justify-content: flex-start;
        }
        .feed-card__refresh {
          opacity: 1;
        }
      }

      /* Discovery revamp */
      .discovery {
        gap: clamp(22px, 3vw, 36px);
      }
      .discovery-hero {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(270px, 0.7fr);
        gap: clamp(16px, 2.6vw, 34px);
        align-items: center;
        padding: clamp(18px, 2.6vw, 34px);
        border: 1px solid var(--line);
        border-radius: calc(var(--radius) + 6px);
        background:
          radial-gradient(circle at 88% 18%, rgba(167, 139, 250, 0.16), transparent 34%),
          radial-gradient(circle at 6% 100%, rgba(56, 225, 255, 0.13), transparent 38%),
          linear-gradient(135deg, var(--surface-2), var(--surface-1));
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .discovery-hero::after {
        content: '';
        position: absolute;
        inset: auto -8% -45% 38%;
        height: 220px;
        border-radius: 50%;
        border: 1px solid rgba(56, 225, 255, 0.12);
        box-shadow: 0 0 0 34px rgba(56, 225, 255, 0.035), 0 0 0 70px rgba(167, 139, 250, 0.025);
        pointer-events: none;
      }
      .discovery-hero__copy {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 10px;
        align-content: center;
      }
      .discovery-hero h2 {
        margin: 0;
        font-size: clamp(1.65rem, 2.7vw, 2.5rem);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      .discovery-hero__lede {
        margin: 0;
        max-width: 58ch;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.6;
      }
      .search-shell {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 640px;
        margin-top: 3px;
        padding: 5px 5px 5px 13px;
        border: 1px solid var(--line-strong);
        border-radius: 999px;
        background: var(--surface-1);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        transition: border-color 140ms ease, box-shadow 140ms ease;
      }
      .search-shell:focus-within {
        border-color: rgba(56, 225, 255, 0.52);
        box-shadow: 0 0 0 3px rgba(56, 225, 255, 0.1);
      }
      .search-shell__icon {
        flex: 0 0 auto;
        color: var(--cyan);
      }
      .search-shell input {
        flex: 1 1 auto;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: 0.86rem;
        padding: 8px 2px;
      }
      .search-shell input::placeholder {
        color: var(--muted-dim);
      }
      .search-shell .btn {
        flex: 0 0 auto;
        border-radius: 999px;
        padding: 8px 16px;
      }
      .search-shell__clear {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 50%;
        background: var(--surface-row-hover);
        color: var(--muted);
        cursor: pointer;
      }
      .search-shell__clear:hover {
        color: var(--text);
      }
      .discovery-hints {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 16px;
        color: var(--muted-dim);
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .discovery-hints span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .featured-pick {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 118px minmax(0, 1fr);
        gap: 13px;
        align-items: center;
        padding: 12px;
        border: 1px solid rgba(56, 225, 255, 0.18);
        border-radius: var(--radius);
        background: rgba(4, 12, 26, 0.36);
        backdrop-filter: blur(14px);
      }
      .featured-pick__art {
        width: 100%;
        border-radius: var(--radius-sm);
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
      }
      .featured-pick__body {
        display: grid;
        gap: 3px;
        min-width: 0;
        align-content: center;
      }
      .featured-pick h3 {
        margin: 0;
        font-size: 1rem;
        line-height: 1.2;
      }
      .featured-pick__author {
        margin: 0;
        color: var(--cyan);
        font-size: 0.76rem;
      }
      .featured-pick__desc {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 2px 0 0;
        color: var(--muted);
        font-size: 0.73rem;
        line-height: 1.45;
      }
      .featured-pick .btn {
        justify-self: start;
        margin-top: 4px;
      }
      .discovery-section-head {
        align-items: flex-end;
      }
      .section-subtitle {
        margin: 2px 0 0;
        color: var(--muted-dim);
        font-size: 0.73rem;
      }
      .recommendation-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(205px, 1fr));
        gap: 10px;
      }
      .recommendation-card,
      .top-card,
      .show-tile {
        transition: border-color 150ms ease, transform 150ms ease, background 150ms ease;
      }
      .recommendation-card {
        display: grid;
        gap: 8px;
        align-content: start;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-1);
      }
      .recommendation-card:hover,
      .top-card:hover,
      .show-tile:hover {
        border-color: var(--line-strong);
        background: var(--surface-2);
        transform: translateY(-2px);
      }
      .recommendation-card sc-artwork,
      .top-card sc-artwork,
      .show-tile sc-artwork {
        width: 100%;
        border-radius: var(--radius-sm);
      }
      .recommendation-card__body,
      .top-card__body,
      .show-tile__body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .recommendation-card h3,
      .top-card h3,
      .show-tile h3 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 0;
        font-size: 0.86rem;
        line-height: 1.3;
      }
      .recommendation-card p,
      .top-card p,
      .show-tile p {
        margin: 0;
        color: var(--muted);
        font-size: 0.72rem;
        line-height: 1.35;
      }
      .recommendation-card .btn,
      .top-card .btn,
      .show-tile .btn {
        justify-self: start;
        margin-top: 3px;
      }
      .category-card {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        grid-template-rows: auto auto;
        gap: 1px 10px;
        align-items: center;
        padding: 11px 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: linear-gradient(135deg, var(--surface-1), var(--surface-3));
        text-align: left;
        color: var(--text);
        font: inherit;
        cursor: pointer;
        transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
      }
      .category-card:hover {
        border-color: var(--line-strong);
        background: var(--surface-2);
        transform: translateY(-1px);
      }
      .category-card__icon {
        grid-row: 1 / span 2;
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        color: var(--cyan);
        background: radial-gradient(circle at 35% 30%, rgba(56, 225, 255, 0.24), rgba(167, 139, 250, 0.12));
        border: 1px solid rgba(56, 225, 255, 0.18);
      }
      .category-card__name {
        font-size: 0.84rem;
        font-weight: 600;
      }
      .category-card__count {
        color: var(--muted-dim);
        font-size: 0.68rem;
      }
      .result {
        align-items: flex-start;
        background: linear-gradient(135deg, var(--surface-1), var(--surface-3));
      }
      .result sc-artwork {
        flex: 0 0 auto;
      }
      .result__title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .result__title-row h3 {
        margin: 0;
        font-size: 0.9rem;
      }
      .result__author {
        color: var(--cyan);
        font-size: 0.72rem;
      }
      .result__description {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin-top: 2px;
        color: var(--muted);
        font-size: 0.75rem;
        line-height: 1.45;
      }
      .result__action {
        align-self: center;
        flex: 0 0 auto;
      }
      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 8px;
      }
      .skeleton-card {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        grid-template-rows: auto auto;
        gap: 8px 12px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--surface-1);
      }
      .skeleton {
        display: block;
        border-radius: 8px;
        background: linear-gradient(
          90deg,
          rgba(148, 197, 255, 0.06) 20%,
          rgba(148, 197, 255, 0.15) 38%,
          rgba(148, 197, 255, 0.06) 56%
        );
        background-size: 400% 100%;
        animation: skeleton-shimmer 1.5s ease infinite;
      }
      .skeleton--art {
        grid-row: 1 / span 2;
        width: 72px;
        height: 72px;
      }
      .skeleton--line {
        width: 84%;
        height: 12px;
        align-self: end;
      }
      .skeleton--short {
        width: 52%;
      }
      @keyframes skeleton-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: 0 0; }
      }
      @media (max-width: 980px) {
        .discovery-hero {
          grid-template-columns: 1fr;
        }
        .featured-pick {
          max-width: 560px;
        }
      }
      @media (max-width: 640px) {
        .discovery-hero {
          padding: 16px;
        }
        .discovery-hero h2 {
          font-size: 1.6rem;
        }
        .discovery-hero__lede {
          font-size: 0.8rem;
        }
        .search-shell {
          flex-wrap: nowrap;
          border-radius: 999px;
          padding: 4px 4px 4px 10px;
        }
        .search-shell input {
          flex: 1 1 auto;
          font-size: 0.8rem;
          padding: 7px 2px;
        }
        .search-shell .btn {
          width: auto;
          padding: 7px 12px;
          font-size: 0.76rem;
        }
        .search-shell__clear {
          width: 22px;
          height: 22px;
        }
        .discovery-hints {
          font-size: 0.6rem;
        }
        .featured-pick {
          grid-template-columns: 88px minmax(0, 1fr);
        }
        .recommendation-grid {
          grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
        }
      }

      .show-settings {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        padding: clamp(14px, 2vw, 22px);
      }
      .show-settings label,
      .show-settings .field {
        color: var(--text);
        font-size: inherit;
        letter-spacing: normal;
        text-transform: none;
      }
      .settings-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .settings-head h3 {
        margin: 2px 0 0;
        font-size: 1.05rem;
      }
      .settings-head .hint {
        max-width: 44ch;
        text-align: right;
      }
      .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 12px;
      }
      .field {
        display: grid;
        gap: 5px;
      }
      .field__label {
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .field select {
        width: 100%;
      }
      .field__hint {
        color: var(--muted-dim);
        font-size: 0.7rem;
        line-height: 1.4;
      }
      .switch-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding-top: 13px;
        border-top: 1px solid var(--line);
        color: var(--text);
        font-size: 0.82rem;
      }
      .switch-row input {
        margin-top: 2px;
      }
      .switch-row > span {
        display: grid;
        gap: 3px;
      }
      @media (max-width: 640px) {
        .settings-head .hint {
          text-align: left;
        }
      }
    `,
  ],
})
export class PodcastsViewComponent {
  protected readonly store = inject(PodcastsStore);
  protected readonly playback = inject(PodcastPlaybackStore);
  protected readonly downloads = inject(DownloadsStore);
  private readonly transitions = inject(ScreenTransitionService);
  private readonly toasts = inject(ToastStore);

  protected readonly tab = signal<PodcastTab>('subscribed');
  protected readonly searchQuery = signal('');
  protected readonly settingsOpen = signal(false);
  protected readonly confirmingFeedId = signal<string | null>(null);
  protected readonly filter = signal<EpisodeFilter>('all');
  protected readonly downloadVariant = signal<PodcastDownloadVariant>('original');
  protected readonly expanded = signal<string | null>(null);
  protected readonly hasSearched = signal(false);

  protected readonly tabs: Array<{ id: PodcastTab; label: string }> = [
    { id: 'subscribed', label: 'Subscribed' },
    { id: 'downloaded', label: 'Downloaded' },
    { id: 'discovery', label: 'Discovery' },
  ];

  protected readonly filters: Array<{ id: EpisodeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'unplayed', label: 'Unplayed' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'video', label: 'Video' },
  ];

  protected readonly episodes = computed(() => {
    const filter = this.filter();
    return this.store.episodes().filter((episode) => {
      if (filter === 'unplayed') return !episode.played;
      if (filter === 'in-progress') return !episode.completed && episode.resumePositionMs > 0;
      if (filter === 'video') return episode.mediaForm === 'video';
      return true;
    });
  });

  protected readonly subscribedUrls = computed(
    () => new Set(this.store.feeds().map((feed) => feed.feedUrl)),
  );

  /**
   * Local recommendation shelf: prefer categories the user already follows,
   * then fall back to the directory's top chart. No remote personalization.
   */
  protected readonly recommendedShows = computed(() => {
    const discovery = this.store.discovery();
    if (!discovery) return [];
    const subscribed = this.subscribedUrls();
    const preferred = new Set(
      this.store
        .feeds()
        .flatMap((feed) => feed.categories.map((category) => category.toLowerCase())),
    );
    const affinity = discovery.shelves
      .filter((shelf) => preferred.has(shelf.category.name.toLowerCase()))
      .flatMap((shelf) => shelf.shows);
    const seen = new Set<string>();
    return [...affinity, ...discovery.top, ...discovery.shelves.flatMap((shelf) => shelf.shows)]
      .filter((show) => {
        if (subscribed.has(show.feedUrl) || seen.has(show.feedUrl)) return false;
        seen.add(show.feedUrl);
        return true;
      })
      .slice(0, 8);
  });

  protected readonly recommendedLabel = computed(() => {
    const category = this.store
      .feeds()
      .flatMap((feed) => feed.categories)
      .find((value) => value.trim().length > 0);
    return category ? `Because you follow ${category}` : 'Popular with listeners right now';
  });

  protected isSubscribed(result: PodcastSearchResult): boolean {
    return this.subscribedUrls().has(result.feedUrl);
  }

  protected readonly downloadedEpisodes = computed(() => {
    const isDownloaded = this.downloads.isDownloaded();
    return this.store
      .downloadPool()
      .filter((episode) => isDownloaded(episode.id))
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  });

  constructor() {
    // Resume progress lives on the host/native store, not in this view. Re-read
    // it whenever the screen opens and mirror the live position while it plays,
    // so "In progress" and "Continue listening" never show a blank session.
    effect(() => {
      const snapshot = this.playback.snapshot();
      const track = snapshot.track;
      const state = snapshot.state;
      if (!track || !this.playback.active()) return;
      if (
        state !== 'playing' &&
        state !== 'buffering' &&
        state !== 'paused' &&
        state !== 'ended'
      ) {
        return;
      }
      const positionMs = this.playback.positionMs();
      const completed = state === 'ended';
      const force = state === 'paused' || state === 'ended';
      untracked(() =>
        this.store.notePlaybackProgress(track.id, positionMs, completed, force),
      );
    });
    void this.store.init().then(async () => {
      // A host read can land after the live tick above; replay the current
      // position so persisted (slightly older) rows do not blank the shelf.
      await this.store.refreshProgress();
      const snapshot = this.playback.snapshot();
      if (snapshot.track && this.playback.active()) {
        this.store.notePlaybackProgress(
          snapshot.track.id,
          this.playback.positionMs(),
          snapshot.state === 'ended',
          true,
        );
      }
    });
    void this.playback.init();
    void this.downloads.init();
  }

  protected selectTab(tab: PodcastTab): Promise<void> {
    if (tab === this.tab()) return Promise.resolve();
    return this.transitions.foamChange(() => {
      this.tab.set(tab);
      if (tab === 'discovery') {
        this.store.clearCategory();
        void this.store.loadDiscovery();
      } else if (tab === 'downloaded') {
        void this.store.loadDownloadPool();
      }
    });
  }

  /** Arrow/Home/End move between tabs, as a tablist is expected to. */
  protected onTabKey(event: KeyboardEvent): void {
    const ids = this.tabs.map((option) => option.id);
    const index = ids.indexOf(this.tab());
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    else return;
    event.preventDefault();
    const nextId = ids[next];
    void this.selectTab(nextId).then(() => {
      document.getElementById(`podcast-tab-${nextId}`)?.focus();
    });
  }

  protected browseCategory(category: PodcastDiscoveryCategory): void {
    void this.store.browseCategory(category);
  }

  protected refreshCurrent(): void {
    if (this.tab() === 'discovery' && !this.store.selectedFeed()) {
      void this.store.loadDiscovery(true);
      return;
    }
    void this.store.refresh(this.store.selectedFeedId() ?? undefined);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
    this.hasSearched.set(false);
    this.store.clearSearch();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement | null)?.checked ?? false;
  }

  protected openFeed(feedId: string): void {
    this.filter.set('all');
    this.expanded.set(null);
    void this.store.selectFeed(feedId);
  }

  protected back(): void {
    void this.store.selectFeed(null);
    this.settingsOpen.set(false);
    this.expanded.set(null);
  }

  protected playLatest(): void {
    const [first] = this.episodes();
    if (first) this.play(first);
  }

  protected play(episode: PodcastEpisode): void {
    void this.playback.playEpisode(episode, this.episodes());
  }

  protected toggleEpisode(episode: PodcastEpisode): void {
    if (this.isCurrent(episode)) {
      void this.playback.toggle();
      return;
    }
    this.play(episode);
  }

  protected setDownloadVariant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as PodcastDownloadVariant;
    this.downloadVariant.set(value);
  }

  protected toggleDownload(episode: PodcastEpisode): void {
    if (this.downloads.isDownloaded()(episode.id)) {
      void this.downloads.remove(episode.id, episode.title);
      return;
    }
    void this.downloads.download(episode.id, episode.title, {
      variant: this.downloadVariant(),
    });
  }

  protected enqueue(episode: PodcastEpisode): void {
    void this.playback.enqueue([episode]).then(() => {
      this.toasts.success('Added to podcast queue', episode.title);
    });
  }

  protected isCurrent(episode: PodcastEpisode): boolean {
    return this.playback.snapshot().track?.id === episode.id;
  }

  protected progressOf(episode: PodcastEpisode): number {
    if (this.isCurrent(episode)) return Math.round(this.playback.progress() * 100);
    if (episode.durationMs <= 0) return 0;
    return Math.min(100, Math.max(0, (episode.resumePositionMs / episode.durationMs) * 100));
  }

  protected toggleNotes(episode: PodcastEpisode): void {
    this.expanded.set(this.expanded() === episode.episodeId ? null : episode.episodeId);
  }

  protected formatDuration = formatDuration;

  protected formatDate(value: string | null): string {
    if (!value) return 'Undated';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Undated'
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected submitSearch(event: Event): void {
    event.preventDefault();
    this.store.clearCategory();
    void this.runSearch(this.searchQuery());
  }

  protected sourceLabel(source: PodcastSearchResult['source']): string {
    return source === 'apple'
      ? 'Apple Podcasts'
      : source === 'fyyd'
        ? 'Fyyd'
        : source === 'podcast-index'
          ? 'Podcast Index'
          : 'Directory';
  }

  private async runSearch(query: string): Promise<void> {
    if (!query.trim()) return;
    this.hasSearched.set(true);
    await this.store.search(query);
  }

  protected subscribeResult(result: PodcastSearchResult): void {
    void this.store.addFeed(result.feedUrl, { artworkUrl: result.artworkUrl }).then((added) => {
      if (!added) return;
      this.tab.set('subscribed');
      this.hasSearched.set(false);
      this.store.clearSearch();
    });
  }

  protected setInterval(feed: PodcastFeed, event: Event): void {
    void this.store.updateFeed(feed.id, {
      refreshIntervalMinutes: Number(this.value(event)),
    });
  }

  protected setSpeed(feed: PodcastFeed, event: Event): void {
    void this.store.updateFeed(feed.id, { defaultSpeed: Number(this.value(event)) });
  }

  protected setSkip(feed: PodcastFeed, kind: 'intro' | 'outro', event: Event): void {
    const seconds = Number(this.value(event));
    void this.store.updateFeed(
      feed.id,
      kind === 'intro' ? { skipIntroSeconds: seconds } : { skipOutroSeconds: seconds },
    );
  }

  protected setSort(feed: PodcastFeed, event: Event): void {
    const sort = this.value(event) === 'oldest' ? 'oldest' : 'newest';
    void this.store.updateFeed(feed.id, { episodeSort: sort });
  }

  protected setMediaForm(feed: PodcastFeed, event: Event): void {
    const defaultMediaForm = this.value(event) === 'video' ? 'video' : 'audio';
    void this.store.updateFeed(feed.id, { defaultMediaForm });
  }

  protected setAutoQueue(feed: PodcastFeed, event: Event): void {
    void this.store.updateFeed(feed.id, { autoQueue: this.checked(event) });
  }

  protected confirmRemove(feed: PodcastFeed): void {
    if (this.confirmingFeedId() !== feed.id) {
      this.confirmingFeedId.set(feed.id);
      return;
    }
    this.confirmingFeedId.set(null);
    void this.store.removeFeed(feed.id);
  }

  protected openLink(url: string): void {
    void bridge()
      .app.openExternal(url)
      .then((result) => {
        if (!result.ok) this.toasts.error(result.error.message, result.error.code);
      })
      .catch((error) => this.toasts.error('Could not open the link', String(error)));
  }
}
