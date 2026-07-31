import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runIngest, AllSourcesFailedError } from './run.js';
import { writeRunReport, summarizeRunReport } from './report.js';
import { runPaths } from './paths.js';
import { REDDIT_COMMUNITIES, LEMMY_COMMUNITIES, LEMMY_INSTANCE, INGEST_WINDOWS } from './communities.js';
import { createRedditClient } from '../sources/reddit.js';
import { createLemmyClient } from '../sources/lemmy.js';
import { createItchClient } from '../sources/itch.js';
import { buildDictionary } from '../extract/dictionary.js';
import { CURATED_ALIASES } from '../extract/aliases.js';
import { createHttpEnrichers } from '../enrich/metadata.js';
import { fileCache } from '../enrich/cache.js';
import { publishCorpus } from '../corpus/publish.js';
import type { SourceAdapter } from './run.js';
import type { CatalogueEntry } from '../extract/dictionary.js';
import type { SourceItem } from '../corpus/schema.js';

const DRY = process.argv.includes('--dry');
const CACHE_DIR = 'data/cache';
const { outDir: OUT_DIR, reportPath: REPORT_PATH } = runPaths(DRY, process.env);

function loadCatalogue(): CatalogueEntry[] {
  if (!existsSync(CACHE_DIR)) return [];
  const rows: CatalogueEntry[] = [];
  for (const file of readdirSync(CACHE_DIR).filter((f) => f.startsWith('steamspy-page'))) {
    const payload = JSON.parse(readFileSync(resolve(CACHE_DIR, file), 'utf8')) as Record<
      string,
      CatalogueEntry
    >;
    rows.push(...Object.values(payload));
  }
  return rows;
}

function redditAdapter(): SourceAdapter {
  const client = createRedditClient();
  let rejections = 0;

  return {
    id: 'reddit',
    communities: [...REDDIT_COMMUNITIES],
    rejections: () => rejections,
    async collect() {
      const items: SourceItem[] = [];
      for (const community of REDDIT_COMMUNITIES) {
        for (const window of INGEST_WINDOWS) {
          try {
            const { items: page } = await client.fetchListing(community, window);
            items.push(...page);
          } catch (error) {
            // One community-window failing is expected traffic shaping, not a
            // source outage; only a total failure surfaces as a source error.
            rejections += 1;
            if (process.env.GRS_VERBOSE) {
              console.warn(`  reddit ${community} ${window}: ${String(error)}`);
            }
          }
        }
      }
      if (items.length === 0) throw new Error(`no items collected across ${rejections} rejections`);
      return items;
    },
  };
}

function lemmyAdapter(): SourceAdapter {
  const client = createLemmyClient({ instance: LEMMY_INSTANCE });
  let rejections = 0;

  return {
    id: 'lemmy',
    communities: [...LEMMY_COMMUNITIES],
    rejections: () => rejections,
    async collect() {
      const items: SourceItem[] = [];
      for (const community of LEMMY_COMMUNITIES) {
        for (const window of INGEST_WINDOWS) {
          try {
            items.push(...(await client.fetchListing(community, window)));
          } catch {
            rejections += 1;
          }
        }
      }
      if (items.length === 0) throw new Error(`no items collected across ${rejections} rejections`);
      return items;
    },
  };
}

function itchAdapter(): SourceAdapter {
  const client = createItchClient();
  return {
    id: 'itch',
    communities: ['itch.io'],
    async collect() {
      const items = await client.fetchFeed('week');
      // Same guard reddit and lemmy carry: a feed that returns 200 and parses to
      // nothing is a broken source reporting success, and a source reporting
      // success is what the run's refusal-to-publish guard keys off.
      if (items.length === 0) throw new Error('itch.io returned no usable items');
      return items;
    },
  };
}

async function main(): Promise<void> {
  const catalogue = loadCatalogue();
  if (catalogue.length === 0) {
    console.error(
      `No catalogue found in ${CACHE_DIR}. Run "npm run dictionary" first — the dictionary ` +
        'is built on a slower cadence than ingest and is a prerequisite for extraction.',
    );
    process.exitCode = 1;
    return;
  }

  const dictionary = buildDictionary(catalogue, { aliases: CURATED_ALIASES });
  console.log(`dictionary: ${dictionary.entries.length} entries from ${catalogue.length} rows`);

  if (DRY) {
    console.log(`dry run: no source will be contacted, writing to ${OUT_DIR}`);
  }

  const adapters = DRY ? [] : [redditAdapter(), lemmyAdapter(), itchAdapter()];

  try {
    const report = await runIngest({
      adapters,
      dictionary,
      enrich: createHttpEnrichers(fileCache(`${CACHE_DIR}/metadata.json`)),
      publish: (corpus) => publishCorpus(corpus, { outDir: OUT_DIR }),
      now: () => new Date().toISOString(),
    });

    writeRunReport(REPORT_PATH, report);
    console.log(summarizeRunReport(report));
  } catch (error) {
    if (error instanceof AllSourcesFailedError) {
      // Still write the report: it is the heartbeat that keeps the schedule
      // alive, and the record of why the run failed (KTD6).
      writeRunReport(REPORT_PATH, error.report);
      console.error(summarizeRunReport(error.report));
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
