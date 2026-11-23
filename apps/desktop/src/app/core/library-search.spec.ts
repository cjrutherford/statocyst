import { describe, expect, it } from 'vitest';
import { rankAndSortSearchEntities, rankSearchEntity } from './library-search';

describe('library search ranking', () => {
  it('orders exact, prefix, substring, then secondary field matches', () => {
    const entities = [
      { identity: 'z', primary: 'A long alpha', secondary: ['other'] },
      { identity: 'c', primary: 'Other', secondary: ['alpha'] },
      { identity: 'b', primary: 'Alphabet' },
      { identity: 'a', primary: 'alpha' },
    ];

    expect(rankAndSortSearchEntities(' alpha ', entities).map((entity) => entity.identity)).toEqual([
      'a', 'b', 'z', 'c',
    ]);
  });

  it('uses stable identity as a tie-break and rejects unrelated entities', () => {
    const entities = [
      { identity: 'zeta', primary: 'Song' },
      { identity: 'Alpha', primary: 'Song' },
      { identity: 'none', primary: 'No match' },
    ];

    expect(rankAndSortSearchEntities('song', entities).map((entity) => entity.identity)).toEqual([
      'Alpha', 'zeta',
    ]);
    expect(rankSearchEntity('absent', entities[0])).toBeNull();
  });
});
