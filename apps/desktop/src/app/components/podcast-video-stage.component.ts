import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
  effect,
} from '@angular/core';
import { PodcastPlaybackStore } from '../core/podcast-playback.store';
import { AudioEngineService } from '../core/audio-engine.service';
import { isNativePlatform } from '../core/bridge';

/**
 * Video presentation for the active podcast episode. Desktop owns the media
 * element and supplies a DOM host; Android/iOS ask the native plugin for the
 * full-screen surface and PiP. Audio-only mode never stops playback.
 */
@Component({
  selector: 'sc-podcast-video-stage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (playback.hasVideo() && playback.track(); as track) {
      <section class="video-stage" aria-label="Video episode">
        @if (!native) {
          <div
            #host
            class="video-stage__frame"
            [class.is-audio-only]="playback.presentation() === 'audio-only'"
          ></div>
        }
        <div class="video-stage__meta">
          <div>
            <p class="eyebrow">{{ track.album }}</p>
            <h2>{{ track.title }}</h2>
            @if (playback.presentation() === 'audio-only') {
              <p class="video-stage__hint">Audio only · video is detached</p>
            }
          </div>
          <div class="video-stage__actions">
            <button
              type="button"
              class="btn btn--quiet"
              [attr.aria-pressed]="playback.presentation() === 'video'"
              (click)="togglePresentation()"
            >
              {{ playback.presentation() === 'video' ? 'Audio only' : 'Play video' }}
            </button>
            <button
              type="button"
              class="btn btn--quiet"
              [disabled]="playback.presentation() !== 'video' || !pipSupported()"
              (click)="pip()"
            >
              Picture-in-Picture
            </button>
            @if (!native) {
              <button
                type="button"
                class="btn btn--quiet"
                [disabled]="playback.presentation() !== 'video'"
                (click)="fullscreen()"
              >
                Fullscreen
              </button>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [
    `
      .video-stage {
        display: grid;
        gap: 10px;
        margin-bottom: 18px;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--surface-2);
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
    `,
  ],
})
export class PodcastVideoStageComponent {
  protected readonly playback = inject(PodcastPlaybackStore);
  protected readonly native = isNativePlatform();
  private readonly engine = inject(AudioEngineService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      if (this.native) return;
      const host = this.host()?.nativeElement;
      const track = this.playback.track();
      const hasVideo = this.playback.hasVideo();
      if (host && hasVideo && track) {
        this.engine.attachVideoHost(host);
      } else if (host) {
        this.engine.detachVideoHost(host);
      }
    });
    this.destroyRef.onDestroy(() => {
      if (!this.native) this.engine.detachVideoHost(this.host()?.nativeElement);
    });
  }

  protected async togglePresentation(): Promise<void> {
    const next = this.playback.presentation() === 'video' ? 'audio-only' : 'video';
    await this.playback.setPresentation(next);
    if (!this.native) return;
    const plugin = this.nativePlugin();
    const method =
      next === 'video'
        ? (plugin?.showVideo ?? plugin?.attachVideoSurface)
        : (plugin?.hideVideo ?? plugin?.detachVideoSurface);
    await method?.call(plugin).catch(() => undefined);
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

  private nativePlugin():
    | {
        showVideo?: () => Promise<unknown>;
        hideVideo?: () => Promise<unknown>;
        attachVideoSurface?: () => Promise<unknown>;
        detachVideoSurface?: () => Promise<unknown>;
        enterPictureInPicture?: () => Promise<unknown>;
        startPictureInPicture?: () => Promise<unknown>;
      }
    | undefined {
    return (window as unknown as {
      Capacitor?: {
        Plugins?: Record<
          string,
          {
            showVideo?: () => Promise<unknown>;
            hideVideo?: () => Promise<unknown>;
            attachVideoSurface?: () => Promise<unknown>;
            detachVideoSurface?: () => Promise<unknown>;
            enterPictureInPicture?: () => Promise<unknown>;
            startPictureInPicture?: () => Promise<unknown>;
          }
        >;
      };
    }).Capacitor?.Plugins?.['Statocyst'];
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
