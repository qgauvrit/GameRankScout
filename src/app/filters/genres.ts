/**
 * The top-level genre set from R21, expressed as community-tag vocabulary.
 *
 * Genre filtering is built on tags rather than formal store genres (D9): store
 * genres are too coarse for mood-based selection — "Indie" and "Action" between
 * them cover most of the catalogue — while tags carry the words readers
 * actually think in. Formal genres are kept as a coarse fallback for games
 * whose tag lookup did not resolve.
 *
 * The finer discovery vocabulary readers care about (roguelike, metroidvania,
 * cozy, souls-like) is deliberately *not* promoted to a top-level entry. It
 * stays reachable through the tag filter, which is the vocabulary itself rather
 * than a curated subset of it.
 */

export interface TopLevelGenre {
  id: string;
  label: string;
  /** Tags and formal genres that place a game in this genre. */
  match: string[];
}

export const ANY = 'any';

export const TOP_LEVEL_GENRES: TopLevelGenre[] = [
  {
    id: 'action-adventure',
    label: 'Action & adventure',
    match: [
      'Action',
      'Adventure',
      'Action-Adventure',
      'Platformer',
      '2D Platformer',
      '3D Platformer',
      'Metroidvania',
      'Hack and Slash',
      'Beat em up',
      'Stealth',
      'Open World',
    ],
  },
  {
    id: 'rpg',
    label: 'RPG',
    match: [
      'RPG',
      'JRPG',
      'CRPG',
      'Action RPG',
      'Turn-Based RPG',
      'Role Playing',
      'Party-Based RPG',
      'Dungeon Crawler',
      'Souls-like',
    ],
  },
  {
    id: 'survival',
    label: 'Survival',
    match: [
      'Survival',
      'Survival Horror',
      'Open World Survival Craft',
      'Crafting',
      'Base Building',
      'Post-apocalyptic',
    ],
  },
  {
    id: 'shooter',
    label: 'Shooter',
    match: [
      'Shooter',
      'FPS',
      'First-Person Shooter',
      'Third-Person Shooter',
      'Looter Shooter',
      'Tactical Shooter',
      'Bullet Hell',
      'Twin Stick Shooter',
    ],
  },
  {
    id: 'simulation',
    label: 'Simulation',
    match: [
      'Simulation',
      'Life Sim',
      'Farming Sim',
      'Management',
      'Colony Sim',
      'City Builder',
      'Immersive Sim',
      'Building',
      'Automation',
    ],
  },
  {
    id: 'strategy',
    label: 'Strategy',
    match: [
      'Strategy',
      'RTS',
      'Real Time Strategy',
      'Turn-Based Strategy',
      'Turn-Based Tactics',
      'Grand Strategy',
      '4X',
      'Tactical',
      'Auto Battler',
      'Tower Defense',
    ],
  },
  {
    id: 'sports-racing',
    label: 'Sports & racing',
    match: [
      'Sports',
      'Racing',
      'Driving',
      'Football',
      'Soccer',
      'Basketball',
      'Automobile Sim',
      'Motorbike',
      'Skateboarding',
    ],
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    match: [
      'Puzzle',
      'Puzzle Platformer',
      'Logic',
      'Hidden Object',
      'Match 3',
      'Programming',
      'Word Game',
    ],
  },
  {
    id: 'fighting',
    label: 'Fighting',
    match: ['Fighting', '2D Fighter', '3D Fighter', 'Beat em up', 'Martial Arts', 'Wrestling'],
  },
  {
    id: 'horror',
    label: 'Horror',
    match: [
      'Horror',
      'Survival Horror',
      'Psychological Horror',
      'Lovecraftian',
      'Gore',
      'Zombies',
    ],
  },
];

/**
 * Tags arrive from several sources with inconsistent punctuation and casing —
 * "Action-Adventure", "action adventure" and "Action Adventure" are one thing.
 */
export function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const GENRE_INDEX = new Map<string, Set<string>>(
  TOP_LEVEL_GENRES.map((genre) => [genre.id, new Set(genre.match.map(normalizeTag))]),
);

/** True when the game's tag vocabulary places it in the given top-level genre. */
export function inGenre(vocabulary: string[], genreId: string): boolean {
  const wanted = GENRE_INDEX.get(genreId);
  if (!wanted) return false;
  return vocabulary.some((term) => wanted.has(normalizeTag(term)));
}
