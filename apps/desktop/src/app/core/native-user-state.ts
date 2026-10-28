import type { Plugin } from '@capacitor/core';

interface UserStatePlugin extends Partial<Plugin> {
  syncUserState?: (state: {
    favorites: string[];
    playlists: { id: string; name: string; trackIds: string[]; createdAt: number }[];
  }) => Promise<unknown>;
}

/**
 * Favorites and playlists are edited in the WebView; the Android Auto browse tree
 * has no WebView, so native keeps a mirror. Fire-and-forget, debounced so a burst
 * of edits becomes one write. No-op outside the Android shell.
 */
let timer: ReturnType<typeof setTimeout> | undefined;
let favorites: string[] = [];
let playlists: { id: string; name: string; trackIds: string[]; createdAt: number }[] = [];

export function pushNativeUserState(
  next: Partial<{ favorites: string[]; playlists: typeof playlists }>,
): void {
  if (next.favorites) favorites = next.favorites;
  if (next.playlists) playlists = next.playlists;
  const plugin = (window as { Capacitor?: { Plugins?: Record<string, UserStatePlugin> } }).Capacitor
    ?.Plugins?.['Statocyst'];
  if (!plugin?.syncUserState) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void plugin.syncUserState?.({ favorites, playlists }).catch((error: unknown) => {
      console.warn('syncUserState failed', error);
    });
  }, 400);
}
