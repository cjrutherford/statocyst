import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DownloadsStore } from '../core/downloads.store';
import { formatBytes } from '../core/format';
import { IconComponent } from './icon.component';

/**
 * The one place download progress is shown: "Downloading 12 of 40", a bar driven
 * by real bytes when sizes are known, what is happening now (a track name, a
 * retry, waiting for network), and Cancel / Retry failed / Dismiss.
 */
@Component({
  selector: 'sc-download-status',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status(); as s) {
      <section class="dls" [class]="'dls dls--' + s.kind" role="status" aria-live="polite" aria-label="Download progress">
        <header class="dls__head">
          <sc-icon name="download" />
          <strong class="dls__title">{{ s.title }}</strong>
          <span class="dls__pct">{{ s.percent }}%</span>
        </header>

        <div
          class="dls__bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="s.percent"
          [attr.aria-valuetext]="s.title + ', ' + s.percent + ' percent'"
        >
          <span [style.width.%]="s.percent"></span>
        </div>

        <p class="dls__detail">{{ s.detail }}</p>
        <p class="dls__meta">
          @if (s.totalBytes) {
            {{ bytes(s.receivedBytes) }} of {{ bytes(s.totalBytes) }} ·
          }
          {{ s.done }} saved
          @if (s.failed > 0) {
            · {{ s.failed }} failed
          }
        </p>

        @if (s.failedEntries.length > 0) {
          <button type="button" class="dls__link" (click)="showFailed.set(!showFailed())" [attr.aria-expanded]="showFailed()">
            {{ showFailed() ? 'Hide' : 'Show' }} failed tracks
          </button>
          @if (showFailed()) {
            <ul class="dls__failed">
              @for (f of s.failedEntries; track f.trackId) {
                <li>
                  <span class="dls__failed-title">{{ f.title }}</span>
                  <span class="dls__failed-error">{{ f.error }}</span>
                </li>
              }
            </ul>
          }
        }

        <div class="dls__actions">
          @if (s.kind === 'done' || s.kind === 'failed') {
            @if (s.failed > 0) {
              <button type="button" class="btn" (click)="downloads.retryFailed()">Retry failed</button>
            }
            <button type="button" class="btn btn--quiet" (click)="dismiss()">Dismiss</button>
          } @else {
            <button type="button" class="btn btn--quiet" (click)="downloads.cancelQueue()">Cancel</button>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        top: max(12px, env(safe-area-inset-top));
        right: 12px;
        width: min(380px, calc(100vw - 24px));
        z-index: 40;
      }
      .dls {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--panel-strong);
        backdrop-filter: blur(14px);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        font-size: 0.85rem;
      }
      .dls--failed {
        border-color: var(--danger);
      }
      .dls--waiting,
      .dls--retrying {
        border-color: var(--warning);
      }
      .dls__head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dls__title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dls__pct {
        font-variant-numeric: tabular-nums;
        color: var(--cyan-soft);
      }
      .dls__bar {
        height: 6px;
        border-radius: 999px;
        background: rgba(148, 197, 255, 0.16);
        overflow: hidden;
      }
      .dls__bar span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--cyan), var(--violet));
        transition: width 0.25s ease;
      }
      .dls--failed .dls__bar span {
        background: var(--danger);
      }
      .dls--waiting .dls__bar span,
      .dls--retrying .dls__bar span {
        background: var(--warning);
      }
      .dls__detail,
      .dls__meta {
        margin: 0;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dls__meta {
        font-size: 0.78rem;
        font-variant-numeric: tabular-nums;
      }
      .dls__link {
        justify-self: start;
        padding: 0;
        border: 0;
        background: none;
        color: var(--cyan-soft);
        cursor: pointer;
        font: inherit;
        text-decoration: underline;
      }
      .dls__failed {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 4px;
        max-height: 140px;
        overflow-y: auto;
      }
      .dls__failed li {
        display: grid;
      }
      .dls__failed-error {
        font-size: 0.76rem;
        color: var(--danger);
      }
      .dls__actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
    `,
  ],
})
export class DownloadStatusComponent {
  protected readonly downloads = inject(DownloadsStore);
  protected readonly status = this.downloads.status;
  protected readonly showFailed = signal(false);
  protected readonly bytes = formatBytes;

  protected dismiss(): void {
    this.showFailed.set(false);
    void this.downloads.dismissQueue();
  }
}
