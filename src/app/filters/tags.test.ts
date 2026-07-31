import { describe, it, expect } from 'vitest';
import { frequentTags } from './tags.js';
import { game } from '../../../test/factory.js';

describe('corpus tag vocabulary', () => {
  it('orders tags by how many games carry them', () => {
    const games = [
      game({ id: 'a', tags: ['Roguelike', 'Cozy'] }),
      game({ id: 'b', tags: ['Roguelike'] }),
      game({ id: 'c', tags: ['Roguelike', 'Horror'] }),
      game({ id: 'd', tags: ['Cozy'] }),
    ];

    expect(frequentTags(games)).toEqual(['Roguelike', 'Cozy', 'Horror']);
  });

  it('counts a game once even when it repeats a tag', () => {
    const games = [
      game({ id: 'a', tags: ['Cozy', 'cozy', 'COZY'] }),
      game({ id: 'b', tags: ['Horror'] }),
      game({ id: 'c', tags: ['Horror'] }),
    ];

    expect(frequentTags(games)[0]).toBe('Horror');
  });

  it('breaks ties alphabetically so the control does not reshuffle', () => {
    const games = [game({ id: 'a', tags: ['Zen', 'Action'] })];

    expect(frequentTags(games)).toEqual(['Action', 'Zen']);
  });

  it('caps the list at the requested length', () => {
    const games = [game({ id: 'a', tags: ['A', 'B', 'C', 'D'] })];

    expect(frequentTags(games, 2)).toHaveLength(2);
  });

  it('returns nothing for a corpus whose games resolved no tags', () => {
    expect(frequentTags([game({ id: 'a', tags: [] })])).toEqual([]);
  });
});
