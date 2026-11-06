import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ScreenTransitionService } from '../core/screen-transition.service';

interface FoamBubble {
  x: number;
  y: number;
  size: number;
  delay: number;
  dx: number;
  dy: number;
}

@Component({
  selector: 'sc-transition-foam',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="foam"
      [class.is-covering]="phase() === 'covering'"
      [class.is-revealing]="phase() === 'revealing'"
      aria-hidden="true"
    >
      <div class="foam__wash"></div>
      <div class="foam__bubbles">
        @for (bubble of bubbles; track $index) {
          <span
            class="foam__bubble"
            [style.--x]="bubble.x + '%'"
            [style.--y]="bubble.y + '%'"
            [style.--s]="bubble.size + 'px'"
            [style.--delay]="bubble.delay + 'ms'"
            [style.--dx]="bubble.dx + 'px'"
            [style.--dy]="bubble.dy + 'px'"
          ></span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        z-index: 40;
        overflow: hidden;
        pointer-events: none;
      }
      .foam {
        position: absolute;
        inset: 0;
      }
      .foam__wash {
        position: absolute;
        inset: -18%;
        opacity: 0;
        transform: scale(0.35);
        transform-origin: 50% 104%;
        background:
          radial-gradient(circle at 50% 104%, var(--foam) 0 32%, var(--foam-2) 54%, transparent 76%),
          radial-gradient(circle at 30% 80%, rgba(255, 255, 255, 0.5), transparent 55%);
        transition:
          opacity var(--motion-foam-cover, 300ms) ease,
          transform var(--motion-foam-cover, 300ms) var(--ease-bubble);
      }
      .foam.is-covering .foam__wash {
        opacity: 0.98;
        transform: scale(1.15);
      }
      .foam.is-revealing .foam__wash {
        opacity: 0;
        transform: scale(1.22);
        transition-duration: var(--motion-foam-reveal, 500ms);
      }
      .foam__bubbles {
        position: absolute;
        inset: 0;
      }
      .foam__bubble {
        position: absolute;
        left: var(--x, 50%);
        top: var(--y, 60%);
        width: var(--s, 16px);
        height: var(--s, 16px);
        border-radius: 50%;
        background: radial-gradient(circle at 34% 30%, #fff, var(--foam-2) 46%, transparent 72%);
        border: 1px solid var(--foam-border, rgba(255, 255, 255, 0.35));
        box-shadow: 0 0 12px var(--foam-glow, rgba(56, 225, 255, 0.55));
        opacity: 0;
        transform: translate3d(0, 26px, 0) scale(0.3);
        transition:
          opacity var(--motion-foam-cover, 300ms) ease,
          transform var(--motion-foam-cover, 300ms) var(--ease-bubble);
        transition-delay: var(--delay, 0ms);
      }
      .foam.is-covering .foam__bubble {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }
      .foam.is-revealing .foam__bubble {
        opacity: 0;
        transform: translate3d(var(--dx, 0px), var(--dy, 0px), 0) scale(1.12);
        transition-duration: var(--motion-foam-reveal, 500ms);
        transition-delay: 0ms;
      }
      .foam:not(.is-covering):not(.is-revealing) .foam__bubble {
        transition: none;
      }
    `,
  ],
})
export class TransitionFoamComponent {
  private readonly transitions = inject(ScreenTransitionService);
  protected readonly phase = this.transitions.foam;

  protected readonly bubbles: FoamBubble[] = Array.from({ length: 34 }, (_, i) => {
    const x = (i * 29 + 8) % 100;
    const y = 18 + ((i * 47) % 78);
    const cx = x - 50;
    const cy = y - 50;
    const length = Math.hypot(cx, cy) || 1;
    const speed = 70 + (i % 6) * 28;
    return {
      x,
      y,
      size: 8 + ((i * 13) % 54),
      delay: (i % 7) * 14,
      dx: Math.round((cx / length) * speed),
      dy: Math.round((cy / length) * speed),
    };
  });
}
