import { describe, it, expect } from 'vitest';
import { corpusDictionary, mergeAdhocItems } from './merge.js';
import { rankGames } from '../../ranking/score.js';
import { corpus, evidence, game } from '../../../test/factory.js';
import type { SourceItem } from '../../corpus/schema.js';

const NOW = Date.parse('2026-07-28T00:00:00.000Z');

function item(overrides: Partial<SourceItem> & { text: string }): SourceItem {
  return {
    source: 'reddit',
    community: 'r/cozygames',
    thread: {
      id: 't3_new',
      title: 'What have you been playing?',
      permalink: 'https://reddit.test/comments/new/',
    },
    window: 'week',
    rankPosition: 0,
    postedAt: '2026-07-27T09:00:00.000Z',
    kind: 'post',
    parentThreadId: null,
    ...overrides,
  };
}

/** Owner and review figures high enough to clear the dictionary's floors. */
function known(id: string, name: string) {
  return game({
    id,
    name,
    ownerBand: { min: 500_000, max: 1_000_000 },
    reviewCount: 20_000,
    evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
  });
}

describe('merging an on-demand community fetch', () => {
  it('resolves a mention against the corpus already loaded', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });

    const result = mergeAdhocItems(loaded, [
      item({ text: 'I finally started Stardew Valley and it is lovely.' }),
    ]);

    expect(result.added).toBe(1);
    expect(result.gamesTouched).toBe(1);
    const merged = result.corpus.games[0]!;
    expect(merged.evidence).toHaveLength(2);
    expect(merged.evidence[1]).toMatchObject({
      community: 'r/cozygames',
      gameId: 'steam:1',
      window: 'week',
    });
  });

  it('lets a newly added community change the ranking before the next run', () => {
    const loaded = corpus({
      games: [
        known('steam:1', 'Stardew Valley'),
        known('steam:2', 'Slay the Spire'),
      ],
    });

    const before = rankGames(loaded.games, { mode: 'hiddenGems', window: 'week', now: NOW });
    const after = rankGames(
      mergeAdhocItems(loaded, [
        item({ text: 'Stardew Valley is the one I keep going back to.' }),
        item({
          thread: {
            id: 't3_two',
            title: 'Cosiest games of the year',
            permalink: 'https://reddit.test/comments/two/',
          },
          text: 'Stardew Valley again, obviously.',
        }),
      ]).corpus.games,
      { mode: 'hiddenGems', window: 'week', now: NOW },
    );

    const scoreOf = (list: typeof before, id: string) =>
      list.find((entry) => entry.game.id === id)!.score;

    expect(scoreOf(after, 'steam:1')).toBeGreaterThan(scoreOf(before, 'steam:1'));
    expect(scoreOf(after, 'steam:2')).toBe(scoreOf(before, 'steam:2'));
  });

  it('reads the thread title as well as the body', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });

    const result = mergeAdhocItems(loaded, [
      item({
        thread: {
          id: 't3_title',
          title: 'Stardew Valley is still the benchmark',
          permalink: 'https://reddit.test/comments/title/',
        },
        text: '',
      }),
    ]);

    expect(result.added).toBe(1);
  });

  it('counts one game once per thread, however often it is named', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });

    const result = mergeAdhocItems(loaded, [
      item({ text: 'Stardew Valley. Stardew Valley. Also Stardew Valley.' }),
    ]);

    expect(result.added).toBe(1);
  });

  it('does not duplicate evidence the corpus already carries', () => {
    const existing = evidence({
      community: 'r/cozygames',
      window: 'week',
      thread: {
        id: 't3_new',
        title: 'What have you been playing?',
        permalink: 'https://reddit.test/comments/new/',
      },
    });
    const loaded = corpus({
      games: [{ ...known('steam:1', 'Stardew Valley'), evidence: [existing] }],
    });

    const result = mergeAdhocItems(loaded, [item({ text: 'Stardew Valley, always.' })]);

    expect(result.added).toBe(0);
    expect(result.corpus.games[0]!.evidence).toHaveLength(1);
  });

  it('ignores a game the loaded corpus has never heard of', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });

    const result = mergeAdhocItems(loaded, [
      item({ text: 'Everyone should play Some Unreleased Thing instead.' }),
    ]);

    expect(result.added).toBe(0);
  });

  it('leaves the loaded corpus untouched', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });
    const snapshot = structuredClone(loaded);

    mergeAdhocItems(loaded, [item({ text: 'Stardew Valley forever.' })]);

    expect(loaded).toEqual(snapshot);
  });

  it('carries engagement figures through when the source supplies them', () => {
    const loaded = corpus({ games: [known('steam:1', 'Stardew Valley')] });

    const result = mergeAdhocItems(loaded, [
      item({ source: 'lemmy', text: 'Stardew Valley.', engagement: { score: 42, comments: 7 } }),
    ]);

    expect(result.corpus.games[0]!.evidence[1]!.engagement).toEqual({ score: 42, comments: 7 });
  });

  it('applies the ingest’s own guards rather than a laxer match', () => {
    // "Control" is an ordinary English word; a bare lower-case use is prose.
    const loaded = corpus({ games: [known('steam:1', 'Control')] });

    const prose = mergeAdhocItems(loaded, [item({ text: 'i lost control of the car' })]);
    expect(prose.added).toBe(0);
  });

  it('builds a dictionary only from games it can identify', () => {
    const dictionary = corpusDictionary([
      known('steam:1', 'Stardew Valley'),
      known('itch:abc', 'Some Itch Game'),
    ]);

    expect(dictionary.entries.some((entry) => entry.gameId === 'steam:1')).toBe(true);
    expect(dictionary.entries.some((entry) => entry.name === 'Some Itch Game')).toBe(false);
  });
});
