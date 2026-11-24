import { describe, expect, it } from 'vitest';
import { NavigationStore } from './navigation.store';

describe('NavigationStore', () => {
  it('keeps primary destinations independent and treats active selection as a no-op', () => {
    const navigation = new NavigationStore();
    navigation.navigate('podcasts');
    navigation.navigate('playlists');
    expect(navigation.view()).toBe('playlists');
    expect(navigation.peekBack()).toBe('library');
    navigation.navigate('playlists');
    expect(navigation.view()).toBe('playlists');
    expect(navigation.back()).toBe(true);
    expect(navigation.view()).toBe('library');
  });

  it('returns through now playing and queue to the invoking destination', () => {
    const navigation = new NavigationStore();
    navigation.navigate('podcasts');
    navigation.navigate('now');
    navigation.navigate('queue');
    expect(navigation.back()).toBe(true);
    expect(navigation.view()).toBe('now');
    expect(navigation.back()).toBe(true);
    expect(navigation.view()).toBe('podcasts');
    expect(navigation.back()).toBe(true);
    expect(navigation.view()).toBe('library');
    expect(navigation.back()).toBe(false);
  });

  it('clears transient history when a primary destination is selected', () => {
    const navigation = new NavigationStore();
    navigation.navigate('now');
    navigation.navigate('queue');
    navigation.navigate('settings');
    expect(navigation.view()).toBe('settings');
    expect(navigation.back()).toBe(true);
    expect(navigation.view()).toBe('library');
  });
});
