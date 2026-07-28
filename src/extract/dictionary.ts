import { isAmbiguousTitle } from './stoplist.js';

/** One row of the bulk catalogue, as the owner-ordered listing supplies it. */
export interface CatalogueEntry {
  appid: number;
  name: string;
  /** Owner band as a display string, e.g. "500,000 .. 1,000,000". */
  owners?: string;
  positive?: number;
  negative?: number;
}

export interface DictionaryEntry {
  gameId: string;
  /** The catalogue's own spelling, used for display. */
  name: string;
  normalized: string;
  tokens: string[];
  ownerMin: number;
  ownerMax: number;
  reviews: number;
  /**
   * True when a bare match is not enough evidence — an ordinary-English title,
   * or a short curated alias. These require capitalisation or quoting.
   */
  ambiguous: boolean;
  /** True when this pattern came from the curated alias map rather than the catalogue. */
  alias: boolean;
}

export interface Dictionary {
  /** Every matchable pattern, keyed by its normalized token sequence. */
  entries: DictionaryEntry[];
  byNormalized: Map<string, DictionaryEntry>;
  minTitleChars: number;
}

/**
 * A title shorter than this is never matched from the catalogue: two- and
 * three-character titles ("Ys", "GRIS") collide with initialisms and ordinary
 * words far more often than they identify the game.
 */
export const MIN_TITLE_CHARS = 4;

/**
 * Existence floor. The catalogue's tail is full of titles that are ordinary
 * words attached to games nobody discusses; requiring a minimum footprint keeps
 * that noise out of the matcher entirely.
 */
export const MIN_OWNERS = 50_000;
export const MIN_REVIEWS = 200;

/**
 * A one-word title collides with prose and with longer proper nouns far more
 * readily than a multi-word one — "Dark" matches inside "Dark Messiah" and
 * "Doom: The Dark Ages", "Mountain" inside "Spiral Mountain". Capitalisation
 * cannot separate those, because the colliding phrase is capitalised too.
 *
 * So a single-token title has to earn its place: it is only matchable when the
 * game is well known enough that a bare mention of the word plausibly refers to
 * it. This keeps Hades, Balatro, Celeste and Subnautica while dropping the
 * catalogue's long tail of one-word titles.
 */
export const SINGLE_TOKEN_MIN_OWNERS = 1_000_000;
export const SINGLE_TOKEN_MIN_REVIEWS = 10_000;

const DIACRITICS = /[̀-ͯ]/g;

/**
 * Folds a title to the form used for matching: case, diacritics, punctuation
 * and conjunctions normalized, subtitle separators reduced to spaces.
 *
 * Apostrophes are removed rather than spaced, so "Baldur's" folds to "baldurs"
 * and matches how people type it.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeTitle(title: string): string[] {
  const normalized = normalizeTitle(title);
  return normalized ? normalized.split(' ') : [];
}

function parseOwnerBand(owners: string | undefined): { min: number; max: number } {
  if (!owners) return { min: 0, max: 0 };
  const numbers = owners.match(/[\d,]+/g);
  if (!numbers || numbers.length === 0) return { min: 0, max: 0 };
  const parsed = numbers.map((n) => Number(n.replace(/,/g, '')));
  return {
    min: parsed[0] ?? 0,
    max: parsed[parsed.length - 1] ?? parsed[0] ?? 0,
  };
}

export interface BuildDictionaryOptions {
  aliases?: Readonly<Record<string, string>>;
  minOwners?: number;
  minReviews?: number;
  minTitleChars?: number;
  singleTokenMinOwners?: number;
  singleTokenMinReviews?: number;
}

/**
 * Builds the matchable dictionary from the bulk catalogue plus curated aliases.
 *
 * Entries below the existence floor are dropped outright; entries that survive
 * but read as ordinary English are kept and marked ambiguous, so the matcher
 * can demand extra evidence rather than losing the game entirely.
 */
export function buildDictionary(
  catalogue: CatalogueEntry[],
  options: BuildDictionaryOptions = {},
): Dictionary {
  const {
    aliases = {},
    minOwners = MIN_OWNERS,
    minReviews = MIN_REVIEWS,
    minTitleChars = MIN_TITLE_CHARS,
    singleTokenMinOwners = SINGLE_TOKEN_MIN_OWNERS,
    singleTokenMinReviews = SINGLE_TOKEN_MIN_REVIEWS,
  } = options;

  const byNormalized = new Map<string, DictionaryEntry>();
  /** Canonical title (normalized) -> game id, so aliases can resolve targets. */
  const canonicalIds = new Map<string, { gameId: string; name: string }>();

  for (const row of catalogue) {
    const normalized = normalizeTitle(row.name);
    if (!normalized) continue;

    const { min, max } = parseOwnerBand(row.owners);
    const reviews = (row.positive ?? 0) + (row.negative ?? 0);
    const gameId = `steam:${row.appid}`;

    canonicalIds.set(normalized, { gameId, name: row.name });

    // Existence floor and minimum length are hard exclusions.
    if (max < minOwners && reviews < minReviews) continue;
    if (normalized.replace(/\s/g, '').length < minTitleChars) continue;
    if (byNormalized.has(normalized)) continue;

    // One-word titles clear a much higher bar (see SINGLE_TOKEN_MIN_OWNERS).
    const tokens = normalized.split(' ');
    if (
      tokens.length === 1 &&
      max < singleTokenMinOwners &&
      reviews < singleTokenMinReviews
    ) {
      continue;
    }

    byNormalized.set(normalized, {
      gameId,
      name: row.name,
      normalized,
      tokens,
      ownerMin: min,
      ownerMax: max,
      reviews,
      ambiguous: isAmbiguousTitle(normalized),
      alias: false,
    });
  }

  for (const [rawAlias, target] of Object.entries(aliases)) {
    const normalizedAlias = normalizeTitle(rawAlias);
    const normalizedTarget = normalizeTitle(target);
    if (!normalizedAlias || byNormalized.has(normalizedAlias)) continue;

    // An alias is only useful if its target actually exists in the catalogue.
    const canonical = canonicalIds.get(normalizedTarget);
    if (!canonical) continue;

    const bare = normalizedAlias.replace(/\s/g, '');
    byNormalized.set(normalizedAlias, {
      gameId: canonical.gameId,
      name: canonical.name,
      normalized: normalizedAlias,
      tokens: normalizedAlias.split(' '),
      ownerMin: 0,
      ownerMax: 0,
      reviews: 0,
      // A short alias ("hk", "er") is only safe with capitalisation evidence.
      ambiguous: bare.length < minTitleChars || isAmbiguousTitle(normalizedAlias),
      alias: true,
    });
  }

  return {
    entries: [...byNormalized.values()],
    byNormalized,
    minTitleChars,
  };
}
