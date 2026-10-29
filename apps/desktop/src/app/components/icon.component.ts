import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'library'
  | 'now'
  | 'queue'
  | 'settings'
  | 'play'
  | 'pause'
  | 'previous'
  | 'next'
  | 'shuffle'
  | 'repeat'
  | 'repeat-one'
  | 'volume'
  | 'mute'
  | 'folder'
  | 'file-plus'
  | 'sparkles'
  | 'search'
  | 'trash'
  | 'up'
  | 'down'
  | 'plus'
  | 'close'
  | 'refresh'
  | 'external'
  | 'check'
  | 'alert'
  | 'wave'
  | 'download'
  | 'offline';

@Component({
  selector: 'sc-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('library') {
          <path d="M5 4v16" />
          <path d="M9 5.5v13" />
          <path d="M13.5 4.6l5.2 1.4-3.1 13.8-5.2-1.4z" />
        }
        @case ('now') {
          <circle cx="12" cy="12" r="2.6" />
          <circle cx="12" cy="12" r="6.4" opacity=".55" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" opacity=".8" />
        }
        @case ('queue') {
          <path d="M4 6h12M4 12h8M4 18h5" />
          <path d="M17 13.5l4 3-4 3z" fill="currentColor" stroke="none" />
        }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        }
        @case ('play') {
          <path d="M8 5.2l11 6.8-11 6.8z" fill="currentColor" stroke="none" />
        }
        @case ('pause') {
          <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
        }
        @case ('previous') {
          <path d="M18.5 5.4v13.2L9 12z" fill="currentColor" stroke="none" />
          <rect x="5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" />
        }
        @case ('next') {
          <path d="M5.5 5.4v13.2L15 12z" fill="currentColor" stroke="none" />
          <rect x="16.6" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none" />
        }
        @case ('shuffle') {
          <path d="M3 7h3.5c4.5 0 6.5 10 11 10H21" />
          <path d="M18 14l3 3-3 3" />
          <path d="M3 17h3.5c1.7 0 3-1.4 4.2-3.2" opacity=".7" />
          <path d="M14.3 8.6C15.3 7.6 16.4 7 17.5 7H21" />
          <path d="M18 4l3 3-3 3" />
        }
        @case ('repeat') {
          <path d="M4 11V9a4 4 0 0 1 4-4h11" />
          <path d="M16 2l3 3-3 3" />
          <path d="M20 13v2a4 4 0 0 1-4 4H5" />
          <path d="M8 22l-3-3 3-3" />
        }
        @case ('repeat-one') {
          <path d="M4 11V9a4 4 0 0 1 4-4h11" />
          <path d="M16 2l3 3-3 3" />
          <path d="M20 13v2a4 4 0 0 1-4 4H5" />
          <path d="M8 22l-3-3 3-3" />
          <path d="M12 9.5v5M11 10.5l1-.9" />
        }
        @case ('volume') {
          <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" />
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.6a7.5 7.5 0 0 1 0 10.8" opacity=".65" />
        }
        @case ('mute') {
          <path d="M4 9.5h3.2L12 5.8v12.4L7.2 14.5H4z" />
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        }
        @case ('folder') {
          <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.6l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5v7.8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" />
        }
        @case ('file-plus') {
          <path d="M6 3.5h7l5 5v12H6z" />
          <path d="M13 3.5v5h5" />
          <path d="M12 13v5M9.5 15.5h5" />
        }
        @case ('sparkles') {
          <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
          <path d="M18.5 15.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.9-2.2-2.1-.8 2.1-.9z" opacity=".7" />
        }
        @case ('search') {
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5L21 21" />
        }
        @case ('trash') {
          <path d="M4 7h16M9.5 4h5M6 7l1 13h10l1-13" />
          <path d="M10 11v5M14 11v5" />
        }
        @case ('up') {
          <path d="M6 14l6-6 6 6" />
        }
        @case ('down') {
          <path d="M6 10l6 6 6-6" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6L6 18" />
        }
        @case ('refresh') {
          <path d="M20 11a8 8 0 1 0-2.3 6.3" />
          <path d="M20 4v7h-7" />
        }
        @case ('external') {
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        }
        @case ('check') {
          <path d="M4.5 12.5l5 5L20 6.5" />
        }
        @case ('alert') {
          <path d="M12 3.5l9 16H3z" />
          <path d="M12 9v4.5M12 17h.01" />
        }
        @case ('wave') {
          <path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3" />
        }
        @case ('download') {
          <path d="M12 4v11" />
          <path d="M7.5 11l4.5 4.5L16.5 11" />
          <path d="M4.5 19.5h15" />
        }
        @case ('offline') {
          <path d="M5 4.5l14 15" opacity=".55" />
          <path d="M12 4v11" />
          <path d="M7.5 11l4.5 4.5L16.5 11" />
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        width: 1em;
        height: 1em;
        line-height: 0;
        flex: none;
      }
      svg {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
