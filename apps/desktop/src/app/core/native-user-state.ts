interface UserStatePlugin {
  getUserState?: () => Promise<{ seeded: boolean; favorites: string[] }>;
  syncUserState?: (state: { favorites: string[]; playlists: StoredPlaylist[] }) => Promise<unknown>;
  addListener?: (event: string, handler: (payload: { favorites: string[] }) => void) => unknown;
}

interface StoredPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

/**
 * Favorites and playlists are mirrored into native storage so the Android Auto browse
 * tree (no WebView) can list them. Favorites are bidirectional — the car can toggle
 * them while the WebView is not running — so once native has been seeded it wins at
 * startup and nothing is pushed until it has been adopted. Playlists are web-owned.
 * No-op outside the Android shell.
 */
let timer: ReturnType<typeof setTimeout> | undefined;
let favorites: string[] = [];
let playlists: StoredPlaylist[] = [];
let ready = false;
let adoptFavorites: ((ids: string[]) => void) | undefined;

const plugin = (): UserStatePlugin | undefined =>
  (window as { Capacitor?: { Plugins?: Record<string, UserStatePlugin> } }).Capacitor?.Plugins?.['Statocyst'];

function schedulePush(): void {
  const native = plugin();
  if (!ready || !native?.syncUserState) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void native.syncUserState?.({ favorites, playlists }).catch((error: unknown) => {
      console.warn('syncUserState failed', error);
    });
  }, 400);
}

/** Called once by FavoritesStore: adopts native favorites if native has been seeded. */
export function initNativeUserState(localFavorites: string[], adopt: (ids: string[]) => void): void {
  favorites = localFavorites;
  adoptFavorites = adopt;
  const native = plugin();
  if (!native?.getUserState) return;
  native.addListener?.('favoritesChanged', (payload) => {
    favorites = payload.favorites;
    adoptFavorites?.(payload.favorites);
  });
  native
    .getUserState()
    .then((state) => {
      if (state.seeded) {
        favorites = state.favorites;
        adopt(state.favorites);
      }
    })
    .catch((error: unknown) => console.warn('getUserState failed', error))
    .finally(() => {
      ready = true;
      schedulePush();
    });
}

export function pushNativeUserState(
  next: Partial<{ favorites: string[]; playlists: StoredPlaylist[] }>,
): void {
  if (next.favorites) favorites = next.favorites;
  if (next.playlists) playlists = next.playlists;
  schedulePush();
}
