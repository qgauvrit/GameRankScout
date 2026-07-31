import type { Platform, RankingWindow, SourceId } from '../corpus/schema.js';
import type { RankingMode } from '../ranking/modes.js';

/**
 * Reader-facing names for the corpus vocabulary. Kept in one place because the
 * ranking view, the detail panel and the filter surface all have to agree —
 * a platform that reads "Switch 2" in a filter and "switch2" in a result would
 * read as two different things.
 */

export const PLATFORM_LABELS: Record<Platform, string> = {
  pc: 'PC',
  switch: 'Switch',
  switch2: 'Switch 2',
  ps5: 'PS5',
  'xbox-series': 'Xbox Series X|S',
  android: 'Android',
  ios: 'iOS',
};

export const STORE_LABELS: Record<string, string> = {
  steam: 'Steam',
  itch: 'itch.io',
  gog: 'GOG',
  epic: 'Epic',
  nintendo: 'Nintendo',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  'app-store': 'App Store',
  'play-store': 'Google Play',
  other: 'Store',
};

export const SOURCE_LABELS: Record<SourceId, string> = {
  reddit: 'Reddit',
  lemmy: 'Lemmy',
  itch: 'itch.io',
  steam: 'Steam',
};

export const WINDOW_LABELS: Record<RankingWindow, string> = {
  week: 'Past week',
  month: 'Past month',
  sixMonths: 'Past six months',
  year: 'Past year',
};

/** Same order the mode control offers them in; Hidden gems leads because it is the default lens (D4). */
export const MODE_LABELS: Record<RankingMode, string> = {
  hiddenGems: 'Hidden gems',
  top: 'Top',
  mostDiscussed: 'Most discussed',
  breakout: 'Breakout',
  rising: 'Rising',
};

/** Steam's verdict, phrased the way the badge itself reads on the store. */
export const DECK_LABELS: Record<string, string | null> = {
  verified: 'Deck Verified',
  playable: 'Deck Playable',
  unsupported: 'Deck Unsupported',
  // Plenty of games have simply never been rated; saying so adds nothing.
  unknown: null,
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

export function storeLabel(store: string): string {
  return STORE_LABELS[store] ?? 'Store';
}

export function sourceLabel(source: SourceId): string {
  return SOURCE_LABELS[source];
}

/** 1_250_000 -> "1.2M". Rounded hard, because these are already estimates. */
export function compactCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * Owner counts arrive as a band rather than a figure, which is honest about how
 * rough the estimate is — so the label keeps the band rather than averaging it
 * into false precision.
 */
export function ownerBandLabel(band: { min: number; max: number } | null): string | null {
  if (!band) return null;
  if (band.max <= 0) return null;
  if (band.min === band.max) return `${compactCount(band.max)} owners`;
  return `${compactCount(band.min)}–${compactCount(band.max)} owners`;
}
