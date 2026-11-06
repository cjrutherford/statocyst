import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { NavigationStore, type View } from './navigation.store';

export type FoamPhase = 'idle' | 'covering' | 'revealing';

interface ViewTransitionLike {
  finished: Promise<void>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => ViewTransitionLike;
};

/** Depth rank used to choose dive (deeper) or surface (shallower). */
const DEPTH: Record<View, number> = {
  settings: 0,
  library: 0,
  playlists: 0,
  offline: 1,
  queue: 2,
  now: 3,
};

/** These must match the foam component's CSS durations. */
const FOAM_COVER_MS = 300;
const FOAM_REVEAL_MS = 500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Owns screen transitions.
 *
 * - Any move involving Now Playing uses the depth/dive View Transition.
 * - Lateral moves between Library, Playlists, Offline, Queue and Settings use
 *   the foam bubble wipe, including Settings' internal tabs.
 * - Reduced motion (OS preference) or a busy transition degrades to an instant
 *   update so taps are never dropped.
 */
@Injectable({ providedIn: 'root' })
export class ScreenTransitionService {
  private readonly navigation = inject(NavigationStore);
  private readonly appRef = inject(ApplicationRef);
  private busy = false;

  /** Read by the foam overlay component. */
  readonly foam = signal<FoamPhase>('idle');

  private get reduced(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  }

  go(view: View): Promise<void> {
    if (view === this.navigation.view()) return Promise.resolve();
    return this.run(view, () => this.navigation.navigate(view));
  }

  /** Returns false when there is nowhere to go. */
  back(): boolean {
    const target = this.navigation.peekBack();
    if (!target) return false;
    void this.run(target, () => this.navigation.back());
    return true;
  }

  /** Foam for an in-place change such as a Settings tab. */
  foamChange(update: () => void): Promise<void> {
    if (this.reduced || this.busy) {
      update();
      this.appRef.tick();
      return Promise.resolve();
    }
    return this.runFoam(update);
  }

  private run(target: View, update: () => void): Promise<void> {
    // Never drop a tap: if a transition is already running, apply the change
    // immediately. The in-flight foam/transition will reveal the latest view.
    if (this.reduced || this.busy) {
      update();
      this.appRef.tick();
      return Promise.resolve();
    }
    if (this.navigation.view() === 'now' || target === 'now') {
      return this.runDeep(target, update);
    }
    return this.runFoam(update);
  }

  private async runDeep(target: View, update: () => void): Promise<void> {
    const direction = DEPTH[target] >= DEPTH[this.navigation.view()] ? 'dive' : 'surface';
    const root = document.documentElement;
    const doc = document as ViewTransitionDocument;

    if (typeof doc.startViewTransition !== 'function') {
      // Older WebView / browser: animate the incoming view only.
      root.dataset['transition'] = direction;
      root.dataset['transitionFallback'] = 'true';
      update();
      this.appRef.tick();
      await wait(420);
      delete root.dataset['transition'];
      delete root.dataset['transitionFallback'];
      return;
    }

    this.busy = true;
    root.dataset['transition'] = direction;
    try {
      const transition = doc.startViewTransition(() => {
        update();
        this.appRef.tick();
      });
      await transition.finished.catch(() => undefined);
    } finally {
      delete root.dataset['transition'];
      this.busy = false;
    }
  }

  private async runFoam(update: () => void): Promise<void> {
    this.busy = true;
    try {
      this.foam.set('covering');
      await wait(FOAM_COVER_MS);
      update();
      this.appRef.tick();
      await nextFrame();
      this.foam.set('revealing');
      await wait(FOAM_REVEAL_MS);
    } finally {
      this.foam.set('idle');
      this.busy = false;
    }
  }
}
