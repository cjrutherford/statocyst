import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { Track } from '@statocyst/contracts';

export type ArtworkSize = 'sm' | 'md' | 'lg' | 'hero';

@Component({
  selector: 'sc-artwork',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="art" [class]="'art--' + size()">
      @if (url() && !failed()) {
        <img
          class="art__image"
          [src]="url()"
          [alt]="alt()"
          loading="lazy"
          decoding="async"
          (error)="failed.set(true)"
        />
      } @else {
        <div class="art__fallback" aria-hidden="true">
          <img src="branding/statocyst-symbol.png" alt="" />
          <span class="art__glow"></span>
        </div>
      }
      @if (track()?.missing) {
        <span class="art__missing">Missing</span>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .art {
        position: relative;
        aspect-ratio: 1;
        width: 100%;
        overflow: hidden;
        border-radius: calc(var(--radius) * 0.8);
        background:
          radial-gradient(circle at 30% 18%, rgba(56, 225, 255, 0.24), transparent 58%),
          radial-gradient(circle at 74% 82%, rgba(167, 139, 250, 0.26), transparent 62%),
          linear-gradient(155deg, #0a1830, #060d1d 62%);
        border: 1px solid rgba(148, 197, 255, 0.16);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      .art--sm {
        width: 44px;
        border-radius: 10px;
      }
      .art--md {
        width: 62px;
        border-radius: 12px;
      }
      .art--lg {
        width: 92px;
        border-radius: 14px;
      }
      .art--hero {
        width: 100%;
        border-radius: 26px;
      }
      .art__image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .art__fallback {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
      .art__fallback img {
        width: 62%;
        height: 62%;
        object-fit: contain;
        opacity: 0.82;
        filter: drop-shadow(0 0 18px rgba(56, 225, 255, 0.32));
      }
      .art__glow {
        position: absolute;
        inset: 12%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(56, 225, 255, 0.16), transparent 68%);
      }
      .art__missing {
        position: absolute;
        inset: auto 6px 6px 6px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(255, 107, 138, 0.16);
        border: 1px solid rgba(255, 107, 138, 0.42);
        color: #ff9eb2;
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        text-align: center;
      }
      .art--sm .art__missing {
        display: none;
      }
    `,
  ],
})
export class ArtworkComponent {
  readonly track = input<Track | null>(null);
  readonly src = input<string | null>(null);
  readonly altText = input<string | null>(null);
  readonly size = input<ArtworkSize>('md');

  protected readonly failed = signal(false);
  protected readonly url = computed(() => this.src() ?? this.track()?.artworkUrl ?? null);
  protected readonly alt = computed(() => {
    const custom = this.altText();
    if (custom) return custom;
    const track = this.track();
    return track ? `${track.title} by ${track.artist}` : 'Artwork';
  });

  constructor() {
    effect(() => {
      this.url();
      untracked(() => this.failed.set(false));
    });
  }
}
