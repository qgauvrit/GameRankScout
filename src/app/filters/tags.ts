import { normalizeTag } from './genres.js';
import type { GameEntry } from '../../corpus/schema.js';

/** How many tags the tag control offers before it stops being a usable list. */
export const TAG_LIMIT = 40;

/**
 * The tag vocabulary of the loaded corpus, commonest first.
 *
 * Derived from the corpus rather than curated, because the point of tag
 * filtering is to reach the words this corpus actually contains — a fixed list
 * would offer tags that match nothing and hide tags that match plenty. Ties
 * break alphabetically so the control does not reshuffle between runs for
 * reasons the reader cannot see.
 */
export function frequentTags(games: GameEntry[], limit: number = TAG_LIMIT): string[] {
  const counts = new Map<string, { label: string; count: number }>();

  for (const game of games) {
    // A game listing the same tag twice must not count twice.
    const seen = new Set<string>();
    for (const tag of game.tags) {
      const key = normalizeTag(tag);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label: tag, count: 1 });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((entry) => entry.label);
}
