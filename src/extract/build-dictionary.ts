import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Builds the game-name dictionary from the bulk catalogue.
 *
 * Runs on a slower cadence than ingest: the catalogue changes far more slowly
 * than discussion does, and a full crawl costs one paced request per 1000-title
 * page. The paged endpoint is ordered by owner count, so the early pages carry
 * the games people actually discuss and a partial crawl still produces a usable
 * dictionary.
 */
const CACHE_DIR = 'data/cache';
const USER_AGENT = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)';

/** SteamSpy throttles the paged catalogue to roughly one request per minute. */
const PAGE_INTERVAL_MS = 62_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pageCount(): number {
  const requested = Number(process.env.GRS_DICTIONARY_PAGES ?? '4');
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 4;
}

async function main(): Promise<void> {
  const pages = pageCount();
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`fetching ${pages} catalogue page(s), paced at ${PAGE_INTERVAL_MS / 1000}s`);

  let written = 0;
  for (let page = 0; page < pages; page += 1) {
    if (page > 0) await sleep(PAGE_INTERVAL_MS);

    const response = await fetch(`https://steamspy.com/api.php?request=all&page=${page}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn(`  page ${page}: HTTP ${response.status}, stopping`);
      break;
    }

    const body = await response.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const count = Object.keys(parsed).length;
    if (count === 0) {
      console.log(`  page ${page}: empty, catalogue exhausted`);
      break;
    }

    writeFileSync(resolve(CACHE_DIR, `steamspy-page${page}.json`), body);
    written += count;
    console.log(`  page ${page}: ${count} titles`);
  }

  console.log(`dictionary source: ${written} catalogue rows in ${CACHE_DIR}`);
}

await main();
