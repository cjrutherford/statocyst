import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  signal,
} from '@angular/core';

interface Mote {
  x: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
}

/**
 * The bathypelagic water layer behind the shell. Fixed, non-interactive and
 * paused whenever the document is hidden. Native builds render half the motes
 * and no second caustic sheet (see styles.scss).
 */
@Component({
  selector: 'sc-underwater-backdrop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="water" [class.is-paused]="paused()" aria-hidden="true">
      <div class="caustic"></div>
      <div class="caustic caustic--b"></div>
      <div class="motes">
        @for (mote of motes; track $index) {
          <span
            class="mote"
            [style.--x]="mote.x + '%'"
            [style.--s]="mote.size + 'px'"
            [style.--dur]="mote.duration + 's'"
            [style.--delay]="mote.delay + 's'"
            [style.--drift]="mote.drift + 'px'"
          ></span>
        }
      </div>
      <div class="vignette"></div>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 0;
        display: block;
        overflow: hidden;
        pointer-events: none;
      }
      .water {
        position: absolute;
        inset: 0;
      }
      .caustic {
        position: absolute;
        inset: -30%;
        background:
          radial-gradient(ellipse 38% 30% at 30% 18%, var(--caustic-1), transparent 72%),
          radial-gradient(ellipse 34% 42% at 78% 58%, var(--caustic-2), transparent 74%),
          radial-gradient(ellipse 55% 30% at 48% 96%, var(--caustic-3), transparent 72%);
        opacity: 0.85;
        mix-blend-mode: screen;
        animation: caustic-drift 38s var(--ease-drift) infinite alternate;
        will-change: transform;
      }
      .caustic--b {
        opacity: 0.5;
        animation-duration: 56s;
        animation-direction: alternate-reverse;
      }
      .motes {
        position: absolute;
        inset: 0;
      }
      .mote {
        position: absolute;
        bottom: -12vh;
        left: var(--x, 50%);
        width: var(--s, 4px);
        height: var(--s, 4px);
        border-radius: 50%;
        background: radial-gradient(circle at 34% 30%, #fff, var(--mote) 42%, transparent 72%);
        border: 1px solid var(--mote-border, transparent);
        box-shadow: 0 0 10px var(--mote-glow, var(--mote));
        opacity: 0;
        animation: mote-rise var(--dur, 24s) linear infinite;
        animation-delay: var(--delay, 0s);
      }
      .vignette {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at 50% 42%, transparent 32%, var(--vignette) 100%);
      }
      .is-paused .caustic,
      .is-paused .mote {
        animation-play-state: paused;
      }
      @keyframes caustic-drift {
        0% {
          transform: translate3d(-3%, -2%, 0) rotate(-4deg) scale(1.04);
        }
        100% {
          transform: translate3d(4%, 3%, 0) rotate(3deg) scale(1.12);
        }
      }
      @keyframes mote-rise {
        0% {
          opacity: 0;
          transform: translate3d(0, 0, 0) scale(0.7);
        }
        12% {
          opacity: 0.7;
        }
        78% {
          opacity: 0.45;
        }
        100% {
          opacity: 0;
          transform: translate3d(var(--drift, 10px), -118vh, 0) scale(1.05);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .caustic,
        .mote {
          animation: none;
          display: none;
        }
      }
    `,
  ],
})
export class UnderwaterBackdropComponent {
  protected readonly paused = signal(
    typeof document !== 'undefined' && document.hidden,
  );

  protected readonly motes: Mote[] = Array.from({ length: 16 }, (_, i) => ({
    x: (i * 37 + 11) % 100,
    size: 2 + (i % 5),
    duration: 18 + (i % 7) * 4,
    delay: -((i * 1.7) % 20),
    drift: -24 + (i % 7) * 8,
  }));

  @HostListener('document:visibilitychange')
  protected onVisibilityChange(): void {
    this.paused.set(document.hidden);
  }
}
