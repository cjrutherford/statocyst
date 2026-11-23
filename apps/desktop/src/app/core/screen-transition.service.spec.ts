import '@angular/compiler';
import { ApplicationRef, createEnvironmentInjector, EnvironmentInjector, Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigationStore } from './navigation.store';
import { ScreenTransitionService } from './screen-transition.service';

describe('ScreenTransitionService pending destination', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applies a tapped destination before Back chooses its origin', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 16));
    const injector = createEnvironmentInjector(
      [
        NavigationStore,
        ScreenTransitionService,
        { provide: ApplicationRef, useValue: { tick: vi.fn() } },
      ],
      Injector.NULL as EnvironmentInjector,
    );
    try {
      const navigation = injector.get(NavigationStore);
      const transitions = injector.get(ScreenTransitionService);
      const tapTransition = transitions.go('podcasts');
      transitions.resolvePendingNavigation();
      expect(navigation.view()).toBe('podcasts');
      expect(await transitions.back()).toBe(true);
      expect(navigation.view()).toBe('library');
      await vi.advanceTimersByTimeAsync(900);
      await tapTransition;
    } finally {
      injector.destroy();
    }
  });

  it('cancels a pending destination when the currently visible destination is selected again', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 16));
    const injector = createEnvironmentInjector(
      [
        NavigationStore,
        ScreenTransitionService,
        { provide: ApplicationRef, useValue: { tick: vi.fn() } },
      ],
      Injector.NULL as EnvironmentInjector,
    );
    try {
      const navigation = injector.get(NavigationStore);
      const transitions = injector.get(ScreenTransitionService);
      const pending = transitions.go('podcasts');
      await transitions.go('library');
      await vi.advanceTimersByTimeAsync(900);
      await pending;
      expect(navigation.view()).toBe('library');
    } finally {
      injector.destroy();
    }
  });
});
