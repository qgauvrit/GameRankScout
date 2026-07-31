import type { SourceId } from '../corpus/schema.js';

/**
 * The communities GRS sweeps.
 *
 * `curated` communities are enabled from the first run, with no configuration
 * (R1, R31): general discussion, communities where people explicitly ask for
 * recommendations, handheld play, and at least one community per top-level
 * genre in R21. `recommended` is the broader list the reader can switch on
 * individually (R2), weighted towards genre- and niche-specific rooms where the
 * unfamiliar things actually get discussed.
 *
 * Every identifier here is checked against the live source by
 * `npm run verify:communities`, which is a script rather than a test because no
 * test may reach a live source (KTD8). A curated identifier that stops
 * resolving fails that check.
 */

export const COMMUNITY_TIERS = ['curated', 'recommended'] as const;
export type CommunityTier = (typeof COMMUNITY_TIERS)[number];

/** What a community is here to cover. Genre ids match `TOP_LEVEL_GENRES`. */
export const COVERAGE_VALUES = [
  'general',
  'recommendations',
  'handheld',
  'platform',
  'action-adventure',
  'rpg',
  'survival',
  'shooter',
  'simulation',
  'strategy',
  'sports-racing',
  'puzzle',
  'fighting',
  'horror',
] as const;
export type Coverage = (typeof COVERAGE_VALUES)[number];

export interface CommunityRef {
  /** `r/name` for Reddit, the bare community name for Lemmy. */
  id: string;
  source: Extract<SourceId, 'reddit' | 'lemmy'>;
  label: string;
  covers: Coverage[];
  tier: CommunityTier;
}

export const COMMUNITY_CATALOGUE: CommunityRef[] = [
  // --- General discussion and recommendation-seeking ---
  { id: 'r/Games', source: 'reddit', label: 'Games', covers: ['general'], tier: 'curated' },
  {
    id: 'r/truegaming',
    source: 'reddit',
    label: 'True Gaming',
    covers: ['general'],
    tier: 'curated',
  },
  {
    id: 'r/patientgamers',
    source: 'reddit',
    label: 'Patient Gamers',
    covers: ['general'],
    tier: 'curated',
  },
  {
    id: 'r/indiegames',
    source: 'reddit',
    label: 'Indie Games',
    covers: ['general'],
    tier: 'curated',
  },
  {
    id: 'r/gamingsuggestions',
    source: 'reddit',
    label: 'Gaming Suggestions',
    covers: ['recommendations'],
    tier: 'curated',
  },
  {
    id: 'r/ShouldIbuythisgame',
    source: 'reddit',
    label: 'Should I Buy This Game',
    covers: ['recommendations'],
    tier: 'curated',
  },
  {
    id: 'r/SteamDeck',
    source: 'reddit',
    label: 'Steam Deck',
    covers: ['handheld'],
    tier: 'curated',
  },
  { id: 'games', source: 'lemmy', label: 'Games (Lemmy)', covers: ['general'], tier: 'curated' },

  // --- One curated community per top-level genre in R21 ---
  {
    id: 'r/metroidvania',
    source: 'reddit',
    label: 'Metroidvania',
    covers: ['action-adventure'],
    tier: 'curated',
  },
  { id: 'r/rpg_gamers', source: 'reddit', label: 'RPG Gamers', covers: ['rpg'], tier: 'curated' },
  {
    id: 'r/survivalgaming',
    source: 'reddit',
    label: 'Survival Gaming',
    covers: ['survival'],
    tier: 'curated',
  },
  { id: 'r/fps', source: 'reddit', label: 'FPS', covers: ['shooter'], tier: 'curated' },
  {
    id: 'r/basebuildinggames',
    source: 'reddit',
    label: 'Base Building Games',
    covers: ['simulation'],
    tier: 'curated',
  },
  {
    id: 'r/RealTimeStrategy',
    source: 'reddit',
    label: 'Real Time Strategy',
    covers: ['strategy'],
    tier: 'curated',
  },
  {
    id: 'r/simracing',
    source: 'reddit',
    label: 'Sim Racing',
    covers: ['sports-racing'],
    tier: 'curated',
  },
  {
    id: 'r/puzzlevideogames',
    source: 'reddit',
    label: 'Puzzle Video Games',
    covers: ['puzzle'],
    tier: 'curated',
  },
  { id: 'r/Fighters', source: 'reddit', label: 'Fighters', covers: ['fighting'], tier: 'curated' },
  {
    id: 'r/HorrorGaming',
    source: 'reddit',
    label: 'Horror Gaming',
    covers: ['horror'],
    tier: 'curated',
  },

  // --- The broader list, opt-in per community (R2) ---
  { id: 'r/roguelites', source: 'reddit', label: 'Roguelites', covers: ['rpg'], tier: 'recommended' },
  {
    id: 'r/roguelikes',
    source: 'reddit',
    label: 'Roguelikes',
    covers: ['rpg'],
    tier: 'recommended',
  },
  {
    id: 'r/cozygames',
    source: 'reddit',
    label: 'Cozy Games',
    covers: ['simulation'],
    tier: 'recommended',
  },
  { id: 'r/JRPG', source: 'reddit', label: 'JRPG', covers: ['rpg'], tier: 'recommended' },
  { id: 'r/CRPG', source: 'reddit', label: 'CRPG', covers: ['rpg'], tier: 'recommended' },
  {
    id: 'r/soulslikes',
    source: 'reddit',
    label: 'Souls-likes',
    covers: ['action-adventure'],
    tier: 'recommended',
  },
  {
    id: 'r/4Xgaming',
    source: 'reddit',
    label: '4X Gaming',
    covers: ['strategy'],
    tier: 'recommended',
  },
  {
    id: 'r/tacticalshooters',
    source: 'reddit',
    label: 'Tactical Shooters',
    covers: ['shooter'],
    tier: 'recommended',
  },
  {
    id: 'r/survivalhorror',
    source: 'reddit',
    label: 'Survival Horror',
    covers: ['horror'],
    tier: 'recommended',
  },
  {
    id: 'r/citybuilders',
    source: 'reddit',
    label: 'City Builders',
    covers: ['simulation'],
    tier: 'recommended',
  },
  {
    id: 'r/pcgaming',
    source: 'reddit',
    label: 'PC Gaming',
    covers: ['platform'],
    tier: 'recommended',
  },
  {
    id: 'r/NintendoSwitch',
    source: 'reddit',
    label: 'Nintendo Switch',
    covers: ['platform'],
    tier: 'recommended',
  },
  { id: 'r/PS5', source: 'reddit', label: 'PS5', covers: ['platform'], tier: 'recommended' },
  { id: 'r/xbox', source: 'reddit', label: 'Xbox', covers: ['platform'], tier: 'recommended' },
  {
    id: 'r/AndroidGaming',
    source: 'reddit',
    label: 'Android Gaming',
    covers: ['platform'],
    tier: 'recommended',
  },
  {
    id: 'r/iosgaming',
    source: 'reddit',
    label: 'iOS Gaming',
    covers: ['platform'],
    tier: 'recommended',
  },
  {
    id: 'r/incremental_games',
    source: 'reddit',
    label: 'Incremental Games',
    covers: ['puzzle'],
    tier: 'recommended',
  },
  {
    id: 'gaming',
    source: 'lemmy',
    label: 'Gaming (Lemmy)',
    covers: ['general'],
    tier: 'recommended',
  },
  {
    id: 'patientgamers',
    source: 'lemmy',
    label: 'Patient Gamers (Lemmy)',
    covers: ['general'],
    tier: 'recommended',
  },
];

export const CURATED_COMMUNITIES = COMMUNITY_CATALOGUE.filter(
  (community) => community.tier === 'curated',
);

export const RECOMMENDED_COMMUNITIES = COMMUNITY_CATALOGUE.filter(
  (community) => community.tier === 'recommended',
);

export function findCommunity(id: string): CommunityRef | undefined {
  return COMMUNITY_CATALOGUE.find((community) => community.id === id);
}

/**
 * Whether an evidence record's community is the one this catalogue id names.
 *
 * The two id spaces are deliberately different. Reddit evidence carries
 * `r/name`, the same string the catalogue uses. Lemmy evidence carries
 * `host/c/slug`, because a community only means something alongside the
 * instance serving it — while the catalogue and the reader both speak the bare
 * slug. Comparing them with `===` silently never matched, which left the
 * reader's off-switch for every Lemmy community inert and its settings row
 * permanently claiming it was not in the corpus.
 *
 * Matching on the suffix also means a reader who enables `games` gets it from
 * whichever instance federated it, which is what enabling a community by name
 * should mean.
 */
export function communityMatches(recordCommunity: string, id: string): boolean {
  return recordCommunity === id || recordCommunity.endsWith(`/c/${id}`);
}
