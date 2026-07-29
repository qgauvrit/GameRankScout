import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_CATALOGUE,
  CURATED_COMMUNITIES,
  RECOMMENDED_COMMUNITIES,
} from './catalogue.js';
import { TOP_LEVEL_GENRES } from '../app/filters/genres.js';
import { assertValidCommunity } from '../sources/reddit.js';
import { assertValidLemmyCommunity } from '../sources/lemmy.js';

describe('community catalogue', () => {
  it('covers every top-level genre in R21 with an enabled default community', () => {
    const covered = new Set<string>(CURATED_COMMUNITIES.flatMap((community) => community.covers));
    const missing = TOP_LEVEL_GENRES.filter((genre) => !covered.has(genre.id)).map(
      (genre) => genre.id,
    );

    // A genre with no default community is a genre filter that returns nothing
    // on a cold open, which reads as a broken product rather than a thin corpus.
    expect(missing).toEqual([]);
  });

  it('ships general discussion, recommendation-seeking and handheld by default (R1)', () => {
    const covered = new Set(CURATED_COMMUNITIES.flatMap((community) => community.covers));

    expect(covered.has('general')).toBe(true);
    expect(covered.has('recommendations')).toBe(true);
    expect(covered.has('handheld')).toBe(true);
  });

  it('offers a broader opt-in list weighted to niche rooms (R2)', () => {
    expect(RECOMMENDED_COMMUNITIES.length).toBeGreaterThan(CURATED_COMMUNITIES.length / 2);
    // The point of the second list is reach into rooms the defaults do not sweep.
    const nicheCoverage = RECOMMENDED_COMMUNITIES.filter((community) =>
      community.covers.some((cover) => cover !== 'general'),
    );
    expect(nicheCoverage.length).toBeGreaterThan(0);
  });

  it('lists every identifier exactly once', () => {
    const ids = COMMUNITY_CATALOGUE.map((community) => community.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses identifiers its own adapters will accept', () => {
    // The live check that these resolve is `npm run verify:communities`; this
    // catches the shape mistakes that would fail at ingest time instead.
    for (const community of COMMUNITY_CATALOGUE) {
      if (community.source === 'reddit') {
        expect(() => assertValidCommunity(community.id)).not.toThrow();
      } else {
        expect(() => assertValidLemmyCommunity(community.id)).not.toThrow();
      }
    }
  });

  it('gives every community a reader-facing label', () => {
    for (const community of COMMUNITY_CATALOGUE) {
      expect(community.label.length).toBeGreaterThan(0);
    }
  });
});
