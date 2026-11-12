import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  viewChild,
  effect,
} from '@angular/core';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { PlaybackStore } from '../core/playback.store';
import { AudioEngineService } from '../core/audio-engine.service';
import { isNativePlatform } from '../core/bridge';

/**
 * The most recently mounted stage owns the one native surface. During a view
 * transition the old stage is destroyed after the new one mounts; its async
 * detach must not tear down the new stage's surface.
 */
let nextStageId = 0;
let activeStageId = 0;

/**
 * Video presentation for the active podcast episode. Desktop owns the media
 * element and supplies a DOM host; Android/iOS place the one native surface
 * over the same host so the video sits inside the app instead of covering it.
 */
@Component({
  selector: 'sc-podcast-video-stage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-mini]': 'compact()' },
  template: `
    @if (hasVideo() && track(); as track) {
      @if (compact()) {
        <span
          #host
          class="mini-video"
          [class.is-audio-only]="presentation() === 'audio-only'"
          aria-hidden="true"
        ></span>
      } @else {
      <section
        class="video-stage"
        [class.is-video]="presentation() === 'video'"
        aria-label="Video episode"
      >
        <div
          #host
          class="video-stage__frame"
          [class.is-audio-only]="presentation() === 'audio-only'"
        ></div>
        <div class="video-stage__meta">
          <div>
            <p class="eyebrow">{{ track.album }}</p>
            <h2>{{ track.title }}</h2>
            @if (presentation() === 'audio-only') {
              <p class="video-stage__hint">Audio only · video is detached</p>
            }
          </div>
          <div class="video-stage__actions">
            <button type="button" class="btn btn--quiet" (click)="togglePlayback()">
              {{ playing() ? 'Pause' : 'Play' }}
            </button>
            <button
              type="button"
              class="btn btn--quiet"
              [attr.aria-pressed]="presentation() === 'video'"
              (click)="togglePresentation()"
            >
              {{ presentation() === 'video' ? 'Audio only' : 'Play video' }}
            </button>
            <button
              type="button"
              class="btn btn--quiet"
              [disabled]="presentation() !== 'video' || !pipSupported()"
              (click)="pip()"
            >
              Picture-in-Picture
            </button>
            @if (!native) {
              <button
                type="button"
                class="btn btn--quiet"
                [disabled]="presentation() !== 'video'"
                (click)="fullscreen()"
              >
                Fullscreen
              </button>
            }
          </div>
        </div>
      </section>
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        position: sticky;
        top: 0;
        z-index: 6;
      }
      :host(.is-mini) {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border-radius: 12px;
        overflow: hidden;
        z-index: 2;
      }
      .mini-video {
        display: block;
        width: 100%;
        height: 100%;
        background: #020813;
      }
      .mini-video.is-audio-only {
        display: none;
      }
      .video-stage {
        display: grid;
        gap: 10px;
        margin: 0 0 18px;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--surface-2);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
      }
      .video-stage__frame {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius-md);
        background: #020813;
        aspect-ratio: 16 / 9;
      }
      .video-stage__frame.is-audio-only {
        display: none;
      }
      .video-stage__meta {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .video-stage__meta h2 {
        margin: 2px 0 0;
        font-size: 1.15rem;
      }
      .video-stage__hint {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 0.8rem;
      }
      .video-stage__actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      @media (max-width: 640px) {
        .video-stage {
          padding: 8px;
          border-radius: var(--radius-md);
        }
        .video-stage__meta h2 {
          font-size: 1rem;
        }
      }
    `,
  ],
})
export class PodcastVideoStageComponent {
  readonly compact = input(false);
  protected readonly playback = inject(PodcastPlaybackStore);
  private readonly music = inject(PlaybackStore);
  protected readonly native = isNativePlatform();
  private readonly engine = inject(AudioEngineService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  private readonly stageId = ++nextStageId;

  private resizeObserver: ResizeObserver | null = null;
  private scrollTarget: HTMLElement | null = null;
  private boundHost: HTMLElement | null = null;
  private syncFrame = 0;
  private attached = false;
  private lastBounds: { left: number; top: number; width: number; height: number } | null = null;

  protected readonly track = computed(() => this.playback.track() ?? this.music.track());
  protected readonly hasVideo = computed(() => {
    if (this.playback.track()) return this.playback.hasVideo();
    const snapshot = this.music.snapshot();
    return (
      snapshot.videoAvailable === true ||
      this.music.track()?.videoAvailable === true ||
      this.music.track()?.mediaForm === 'video'
    );
  });
  protected readonly presentation = computed<'audio-only' | 'video'>(() => {
    if (this.playback.track()) return this.playback.presentation();
    return this.music.snapshot().presentation === 'video' ? 'video' : 'audio-only';
  });
  protected readonly playing = computed(() =>
    this.playback.track() ? this.playback.isPlaying() : this.music.isPlaying(),
  );

  constructor() {
    activeStageId = this.stageId;
    effect(() => {
      const host = this.host()?.nativeElement;
      const track = this.track();
      const hasVideo = this.hasVideo();
      const presentation = this.presentation();

      if (!this.native) {
        if (host && hasVideo && track) this.engine.attachVideoHost(host);
        else if (host) this.engine.detachVideoHost(host);
        return;
      }

      this.bindHost(host);
      if (host && hasVideo && presentation === 'video') {
        // The frame is display:none in audio-only, so wait for layout before
        // reporting its rect; scrolling later only updates the same rect.
        this.scheduleSync();
      } else if (!hasVideo || presentation === 'audio-only') {
        void this.detachNative();
      }
    });

    // Starting a video from an episode below the fold should bring the stage
    // into view, not leave the user staring at a list while audio plays.
    let wasVideo = false;
    effect(() => {
      const isVideo = this.hasVideo() && this.presentation() === 'video';
      if (isVideo && !wasVideo && !this.compact()) requestAnimationFrame(() => this.reveal());
      wasVideo = isVideo;
    });

    this.destroyRef.onDestroy(() => {
      if (!this.native) this.engine.detachVideoHost(this.host()?.nativeElement);
      this.resizeObserver?.disconnect();
      this.scrollTarget?.removeEventListener('scroll', this.onViewportChange);
      window.removeEventListener('resize', this.onViewportChange);
      if (this.syncFrame) cancelAnimationFrame(this.syncFrame);
      const owns = this.stageId === activeStageId;
      if (owns) activeStageId = 0;
      void this.detachNative(owns);
    });
  }

  /** Brings the sticky stage into view when an episode starts below the fold. */
  reveal(): void {
    const host = this.host()?.nativeElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    this.scheduleSync();
  }

  protected togglePlayback(): void {
    if (this.playback.track()) void this.playback.toggle();
    else void this.music.toggle();
  }

  protected async togglePresentation(): Promise<void> {
    const next = this.presentation() === 'video' ? 'audio-only' : 'video';
    if (this.playback.track()) await this.playback.setPresentation(next);
    else await this.music.command({ type: 'setPresentation', mode: next });
    if (!this.native) return;
    if (next === 'audio-only') await this.detachNative();
    else this.scheduleSync();
  }

  protected pipSupported(): boolean {
    if (this.native) return true;
    return typeof document !== 'undefined' && 'pictureInPictureEnabled' in document
      ? (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true
      : false;
  }

  protected async pip(): Promise<void> {
    if (this.native) {
      const plugin = this.nativePlugin();
      const start = plugin?.enterPictureInPicture ?? plugin?.startPictureInPicture;
      await start?.call(plugin).catch(() => undefined);
      return;
    }
    const video = this.engine.videoElement;
    if (!video || !this.pipSupported()) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // The control is best-effort; playback is unaffected.
    }
  }

  private bindHost(host: HTMLElement | undefined): void {
    if (!host || host === this.boundHost) return;
    this.boundHost = host;
    this.resizeObserver?.disconnect();
    this.scrollTarget?.removeEventListener('scroll', this.onViewportChange);
    window.removeEventListener('resize', this.onViewportChange);
    this.resizeObserver = new ResizeObserver(() => this.scheduleSync());
    this.resizeObserver.observe(host);
    this.scrollTarget = this.nearestScrollParent(host);
    this.scrollTarget?.addEventListener('scroll', this.onViewportChange, { passive: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
  }

  private readonly onViewportChange = (): void => this.scheduleSync();

  private scheduleSync(): void {
    if (!this.native || this.syncFrame) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      void this.syncNativeSurface();
    });
  }

  private async syncNativeSurface(): Promise<void> {
    if (this.stageId !== activeStageId) return;
    const host = this.host()?.nativeElement;
    if (!host) return;
    if (this.presentation() !== 'video' || !this.hasVideo()) {
      await this.detachNative();
      return;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      await this.detachNative();
      return;
    }
    const density = window.devicePixelRatio || 1;
    const bounds = {
      left: Math.round(rect.left * density),
      top: Math.round(rect.top * density),
      width: Math.round(rect.width * density),
      height: Math.round(rect.height * density),
    };
    if (
      this.lastBounds &&
      this.lastBounds.left === bounds.left &&
      this.lastBounds.top === bounds.top &&
      this.lastBounds.width === bounds.width &&
      this.lastBounds.height === bounds.height
    ) {
      return;
    }
    const plugin = this.nativePlugin();
    if (!plugin) return;
    if (this.attached) {
      this.lastBounds = bounds;
      await plugin.updateVideoSurface?.(bounds).catch(() => undefined);
      return;
    }
    const result = await plugin
      .setPresentation?.({
        mode: 'video',
        posterUrl: this.track()?.artworkUrl ?? null,
        ...bounds,
      })
      .catch(() => undefined);
    if (result !== undefined) {
      // Android returns an explicit attached flag; iOS owns its AVPlayerLayer
      // and reports no flag, so a successful setPresentation is enough.
      this.attached = (result as { attached?: boolean }).attached !== false;
    }
    if (!this.attached) {
      const attached = await plugin.attachVideoSurface?.(bounds).catch(() => undefined);
      this.attached = Boolean((attached as { attached?: boolean } | undefined)?.attached);
    }
    if (this.attached) this.lastBounds = bounds;
  }

  private async detachNative(force = false): Promise<void> {
    if (!force && this.stageId !== activeStageId) return;
    this.attached = false;
    this.lastBounds = null;
    const plugin = this.nativePlugin();
    await plugin?.detachVideoSurface?.().catch(() => undefined);
  }

  private nearestScrollParent(element: HTMLElement): HTMLElement | null {
    let node = element.parentElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }

  private nativePlugin():
    | {
        setPresentation?: (options: Record<string, unknown>) => Promise<unknown>;
        attachVideoSurface?: (bounds: Record<string, number>) => Promise<unknown>;
        updateVideoSurface?: (bounds: Record<string, number>) => Promise<unknown>;
        detachVideoSurface?: () => Promise<unknown>;
        enterPictureInPicture?: () => Promise<unknown>;
        startPictureInPicture?: () => Promise<unknown>;
      }
    | undefined {
    return (
      window as unknown as {
        Capacitor?: {
          Plugins?: Record<
            string,
            {
              setPresentation?: (options: Record<string, unknown>) => Promise<unknown>;
              attachVideoSurface?: (bounds: Record<string, number>) => Promise<unknown>;
              updateVideoSurface?: (bounds: Record<string, number>) => Promise<unknown>;
              detachVideoSurface?: () => Promise<unknown>;
              enterPictureInPicture?: () => Promise<unknown>;
              startPictureInPicture?: () => Promise<unknown>;
            }
          >;
        };
      }
    ).Capacitor?.Plugins?.['Statocyst'];
  }

  protected async fullscreen(): Promise<void> {
    const host = this.host()?.nativeElement;
    if (!host) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await host.requestFullscreen();
      }
    } catch {
      // Fullscreen may be unavailable under some Linux window managers.
    }
  }
}
