export interface LibraryHistoryEntry {
  mode: 'tracks' | 'albums' | 'artists';
  detail: { kind: 'artist'; artist: string } | { kind: 'album'; album: string; artist: string } | null;
  scrollTop: number;
}

export function libraryBackLabel(history: readonly LibraryHistoryEntry[], search: string): string {
  const previous = history.at(-1);
  if (previous?.detail?.kind === 'artist') return previous.detail.artist;
  if (previous?.detail?.kind === 'album') return previous.detail.album;
  if (previous?.mode === 'artists') return 'Artists';
  if (previous?.mode === 'albums') return 'Albums';
  return search.trim() ? 'Search results' : 'Tracks';
}
