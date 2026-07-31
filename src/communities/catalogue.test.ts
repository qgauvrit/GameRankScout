import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_CATALOGUE,
  CURATED_COMMUNITIES,
  RECOMMENDED_COMMUNITIES,
  communityMatches,
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

  it('matches evidence against a catalogue id across both id spaces', () => {
    // Reddit evidence carries the catalogue's own string; Lemmy evidence is
    // qualified by the instance that served it. Comparing with === matched the
    // first and silently never matched the second.
    expect(communityMatches('r/patientgamers', 'r/patientgamers')).toBe(true);
    expect(communityMatches('lemmy.world/c/games', 'games')).toBe(true);
    // Enabling a community by name gets it from whichever instance federated it.
    expect(communityMatches('beehaw.org/c/games', 'games')).toBe(true);

    expect(communityMatches('r/patientgamers', 'r/truegaming')).toBe(false);
    expect(communityMatches('lemmy.world/c/gaming', 'games')).toBe(false);
    // A suffix that is not a community boundary must not match.
    expect(communityMatches('lemmy.world/c/boardgames', 'games')).toBe(false);
  });

  it('matches every curated community against the id space its own source emits', () => {
    for (const community of CURATED_COMMUNITIES) {
      const asEmitted =
        community.source === 'lemmy' ? `lemmy.world/c/${community.id}` : community.id;
      expect(communityMatches(asEmitted, community.id)).toBe(true);
    }
  });

  it('gives every community a reader-facing label', () => {
    for (const community of COMMUNITY_CATALOGUE) {
      expect(community.label.length).toBeGreaterThan(0);
    }
  });
});
