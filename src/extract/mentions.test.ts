import { describe, it, expect } from 'vitest';
import { buildDictionary, normalizeTitle } from './dictionary.js';
import { extractMentions } from './mentions.js';
import type { CatalogueEntry } from './dictionary.js';

/** A small, explicit catalogue so these tests never depend on a cached crawl. */
const CATALOGUE: CatalogueEntry[] = [
  { appid: 553420, name: 'Tunic', owners: '500,000 .. 1,000,000', positive: 20_000, negative: 900 },
  { appid: 753640, name: 'Outer Wilds', owners: '1,000,000 .. 2,000,000', positive: 40_000, negative: 2_000 },
  { appid: 367520, name: 'Hollow Knight', owners: '5,000,000 .. 10,000,000', positive: 200_000, negative: 4_000 },
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', owners: '20,000,000 .. 50,000,000', positive: 600_000, negative: 20_000 },
  { appid: 105600, name: 'Terraria', owners: '20,000,000 .. 50,000,000', positive: 900_000, negative: 20_000 },
  // Ordinary-English titles — the guard cases.
  { appid: 48000, name: 'LIMBO', owners: '5,000,000 .. 10,000,000', positive: 40_000, negative: 2_000 },
  { appid: 400, name: 'Portal', owners: '10,000,000 .. 20,000,000', positive: 100_000, negative: 2_000 },
  { appid: 870780, name: 'Control', owners: '2,000,000 .. 5,000,000', positive: 50_000, negative: 5_000 },
  { appid: 252950, name: 'Rocket League', owners: '20,000,000 .. 50,000,000', positive: 300_000, negative: 40_000 },
  // Short title — below the minimum length threshold.
  { appid: 38700, name: 'Ys', owners: '200,000 .. 500,000', positive: 3_000, negative: 200 },
];

const ALIASES = {
  botw: 'The Legend of Zelda: Breath of the Wild',
  'the witcher 3': 'The Witcher 3: Wild Hunt',
  tw3: 'The Witcher 3: Wild Hunt',
  hk: 'Hollow Knight',
};

const dictionary = buildDictionary(CATALOGUE, { aliases: ALIASES });

function names(text: string): string[] {
  return extractMentions(text, dictionary).map((m) => m.name);
}

describe('normalizeTitle', () => {
  it('folds case, punctuation, subtitles and conjunctions to a comparable form', () => {
    expect(normalizeTitle('The Witcher 3: Wild Hunt')).toBe('the witcher 3 wild hunt');
    expect(normalizeTitle('Ori & the Blind Forest')).toBe('ori and the blind forest');
    expect(normalizeTitle("Baldur's Gate 3")).toBe('baldurs gate 3');
    expect(normalizeTitle('LIMBO™')).toBe('limbo');
    expect(normalizeTitle('Pokémon')).toBe('pokemon');
    expect(normalizeTitle('  spaced   out  ')).toBe('spaced out');
  });
});

describe('extractMentions', () => {
  it('yields exactly the named game for a comment in plain prose', () => {
    expect(names('I finally played Tunic last week and it was wonderful.')).toEqual(['Tunic']);
  });

  it('yields no mention for an ordinary-English title used in a non-game sense', () => {
    expect(names('I was in limbo waiting for the patch to land.')).toEqual([]);
    expect(names('You have no control over the camera in that section.')).toEqual([]);
    expect(names('The portal at the back of the room is just scenery.')).toEqual([]);
  });

  it('still matches an ordinary-English title when it is capitalised as a title', () => {
    expect(names('LIMBO is still the best thing Playdead made.')).toEqual(['LIMBO']);
    expect(names('Control has the best combat of any game that year.')).toEqual(['Control']);
  });

  it('matches an ordinary-English title when it is quoted', () => {
    expect(names('Try "portal" if you have somehow never played it.')).toEqual(['Portal']);
  });

  it('resolves a community shorthand to the canonical game it abbreviates', () => {
    expect(names('HK is still the high point of the genre for me.')).toEqual(['Hollow Knight']);
    expect(names('TW3 holds up better than I expected.')).toEqual(['The Witcher 3: Wild Hunt']);
  });

  it('yields one mention each for several games, without duplicates', () => {
    const found = names(
      'Between Tunic, Outer Wilds and Hollow Knight I had a very good year. Tunic especially.',
    );

    expect(found.sort()).toEqual(['Hollow Knight', 'Outer Wilds', 'Tunic']);
  });

  it('yields zero mentions for a comment naming no game', () => {
    expect(names('Honestly I just want something short with a real ending.')).toEqual([]);
    expect(names('')).toEqual([]);
  });

  it('never matches a title shorter than the minimum length threshold', () => {
    expect(names('Ys is a series I keep meaning to start.')).toEqual([]);
  });

  it('prefers the longest title when one title contains another', () => {
    expect(names('The Witcher 3: Wild Hunt is the one I mean.')).toEqual([
      'The Witcher 3: Wild Hunt',
    ]);
  });

  it('matches on whole words only, never inside a longer word', () => {
    expect(names('The terrarium in my office needs watering.')).toEqual([]);
    expect(names('Portals as a concept are overused in level design.')).toEqual([]);
  });

  it('reports where each mention was found so evidence can be audited', () => {
    const mentions = extractMentions('I played Tunic yesterday.', dictionary);

    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.surface).toBe('Tunic');
    expect(mentions[0]?.gameId).toBe('steam:553420');
    expect('I played Tunic yesterday.'.slice(mentions[0]!.start, mentions[0]!.end)).toBe('Tunic');
  });

  it('matches a title written with different punctuation than the catalogue uses', () => {
    expect(names('The Witcher 3 Wild Hunt was on sale.')).toEqual(['The Witcher 3: Wild Hunt']);
  });

  it('does not let a stoplisted word inside a longer real title suppress that title', () => {
    expect(names('Rocket League is still fun in small doses.')).toEqual(['Rocket League']);
  });

  it('applies an existence floor so obscure catalogue noise cannot match', () => {
    const noisy = buildDictionary(
      [
        ...CATALOGUE,
        { appid: 999999, name: 'Adventure', owners: '0 .. 20,000', positive: 2, negative: 1 },
      ],
      { aliases: ALIASES },
    );

    expect(extractMentions('This was quite the adventure honestly.', noisy)).toEqual([]);
  });
});

describe('titles built entirely from ordinary words', () => {
  const catalogue = [
    ...CATALOGUE,
    { appid: 601530, name: 'Last Year', owners: '500,000 .. 1,000,000', positive: 6_000, negative: 3_000 },
    { appid: 322330, name: 'Dont Starve Together', owners: '10,000,000 .. 20,000,000', positive: 200_000, negative: 10_000 },
  ];
  const dict = buildDictionary(catalogue, { aliases: ALIASES });
  const found = (text: string) => extractMentions(text, dict).map((m) => m.name);

  it('does not match a title made of ordinary words used as prose', () => {
    // This was ranking first in the default view off exactly this phrasing.
    expect(found('I played it last year and bounced off it.')).toEqual([]);
    expect(found('It took me about a week and a half last year.')).toEqual([]);
  });

  it('still matches that title when it is written as a title', () => {
    expect(found('Last Year is a much better asymmetric horror game than it got credit for.')).toEqual([
      'Last Year',
    ]);
  });

  it('leaves a title containing a distinctive word alone', () => {
    expect(found('me and a friend play dont starve together most evenings')).toEqual([
      'Dont Starve Together',
    ]);
  });
});
