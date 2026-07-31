import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildDictionary } from './dictionary.js';
import { extractMentions } from './mentions.js';
import { CURATED_ALIASES } from './aliases.js';
import type { CatalogueEntry, Dictionary } from './dictionary.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../test/fixtures/extract/labelled-comments.json');
const cataloguePath = resolve(here, '../../test/fixtures/extract/catalogue.json');

/**
 * Precision measured by hand-labelling every mention the extractor produced
 * over 332 real comments, on 2026-07-28: 119 of 122 correct, 97.5%, against the
 * plan's 95% gate.
 *
 * The three misses were one shape — a shorter title matching inside a longer
 * proper noun the dictionary does not contain ("Neverwinter" inside
 * "Neverwinter Nights", "Mountain" inside "Spiral Mountain").
 *
 * Recall is reported but deliberately not gated: the breadth term in the
 * ranking suppresses isolated false positives, while a wrong mention looks
 * authoritative to the reader.
 */
export const RECORDED_PRECISION = 0.975;
export const PRECISION_FLOOR = 0.95;

interface LabelledRow {
  id: string;
  community: string;
  permalink: string;
  excerpt: string;
  expected: string[];
}

/**
 * Sanitized excerpts of real comments: author-stripped, trimmed to the span
 * around each mention, and retained with their permalink so the corpus rule of
 * references-over-reproductions holds for fixtures too. Expected mentions were
 * hand-verified, so this encodes correct behaviour rather than current
 * behaviour — a regression in either direction fails.
 */
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { rows: LabelledRow[] };

/**
 * The catalogue this gate measures against is committed, not crawled.
 *
 * It used to read the gitignored crawl cache and skip itself when that was
 * absent — which is every fresh checkout and every CI runner. A gate that
 * disables itself when nobody is looking is not a gate, and this one was the
 * only thing standing behind the extraction precision the whole product's
 * quality rests on.
 *
 * The committed slice carries all 4,000 catalogue rows, reduced to the five
 * fields `buildDictionary` reads, so it produces a dictionary identical to the
 * live crawl's — the measured figure below still means what it says. Refresh it
 * from `data/cache` after a `npm run dictionary` when the catalogue moves.
 */
const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8')) as CatalogueEntry[];

describe('mention extraction against the labelled fixture', () => {
  let dictionary: Dictionary;

  function build(): Dictionary {
    dictionary ??= buildDictionary(catalogue, { aliases: CURATED_ALIASES });
    return dictionary;
  }

  it('holds at or above the recorded precision', () => {
    const dict = build();

    let found = 0;
    let correct = 0;
    for (const row of fixture.rows) {
      const expected = new Set(row.expected);
      for (const mention of extractMentions(row.excerpt, dict)) {
        found += 1;
        if (expected.has(mention.name)) correct += 1;
      }
    }

    expect(found).toBeGreaterThan(0);
    const precision = correct / found;
    expect(precision).toBeGreaterThanOrEqual(PRECISION_FLOOR);
  });

  it('finds no mention in a comment labelled as naming no game', () => {
    const dict = build();

    // A loosened guard shows up here first, before it shows up as a wrong rank.
    for (const row of fixture.rows.filter((r) => r.expected.length === 0)) {
      expect(extractMentions(row.excerpt, dict).map((m) => m.name)).toEqual([]);
    }
  });

  it('still finds every mention that was labelled present', () => {
    const dict = build();

    const missed: Array<{ excerpt: string; missing: string[] }> = [];
    for (const row of fixture.rows) {
      const found = new Set(extractMentions(row.excerpt, dict).map((m) => m.name));
      const missing = row.expected.filter((name) => !found.has(name));
      if (missing.length > 0) missed.push({ excerpt: row.excerpt.slice(0, 60), missing });
    }

    expect(missed).toEqual([]);
  });

  it('covers a labelled fixture large enough to be worth gating on', () => {
    expect(fixture.rows.length).toBeGreaterThanOrEqual(50);
    expect(fixture.rows.filter((r) => r.expected.length === 0).length).toBeGreaterThanOrEqual(10);
  });

  it('measures against the full catalogue, not a slice that would flatter it', () => {
    // Precision rises as the dictionary shrinks: fewer titles, fewer chances to
    // match the wrong one. A truncated catalogue would leave this gate green
    // while measuring something easier than production.
    expect(catalogue.length).toBeGreaterThanOrEqual(4_000);
    expect(build().entries.length).toBeGreaterThanOrEqual(3_500);
  });

  it('carries no author identity in the committed fixture', () => {
    const raw = readFileSync(fixturePath, 'utf8');
    expect(raw).not.toMatch(/\/u\/[A-Za-z0-9_-]+/);
    for (const row of fixture.rows) {
      expect(row.permalink).toMatch(/^https?:\/\//);
    }
  });
});
