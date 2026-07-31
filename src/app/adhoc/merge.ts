import { buildDictionary } from '../../extract/dictionary.js';
import { extractMentions } from '../../extract/mentions.js';
import { CURATED_ALIASES } from '../../extract/aliases.js';
import type { Dictionary } from '../../extract/dictionary.js';
import type { Corpus, EvidenceRecord, GameEntry, SourceItem } from '../../corpus/schema.js';

/**
 * Folding an on-demand community fetch into the corpus already in the browser
 * (R8, F3).
 *
 * Resolution happens here rather than in the edge function because the full
 * title dictionary is a build artifact far too large to load and index inside a
 * per-invocation CPU budget — while the browser is already holding a corpus of
 * canonical game names with owner bands and review counts, which is exactly
 * what the dictionary builder needs. The same guards the scheduled ingest uses
 * therefore apply, rather than a second, laxer matcher.
 *
 * The trade is that only games the corpus already knows can be resolved. A
 * genuinely new game in an added community waits for the next scheduled run.
 */

const STEAM_ID = /^steam:(\d+)$/;

/** Builds the matcher from the corpus in hand, reusing the ingest's guards (KTD3). */
export function corpusDictionary(games: GameEntry[]): Dictionary {
  return buildDictionary(
    games.flatMap((game) => {
      const match = STEAM_ID.exec(game.id);
      if (!match) return [];
      return [
        {
          appid: Number(match[1]),
          name: game.name,
          owners: game.ownerBand
            ? `${game.ownerBand.min} .. ${game.ownerBand.max}`
            : undefined,
          positive: game.reviewCount ?? 0,
          negative: 0,
        },
      ];
    }),
    { aliases: CURATED_ALIASES },
  );
}

export interface MergeResult {
  corpus: Corpus;
  /** How many evidence records were actually new. */
  added: number;
  /** Games the fetched community mentioned that this corpus already ranks. */
  gamesTouched: number;
}

function evidenceKey(record: EvidenceRecord): string {
  return `${record.source}:${record.thread.id}:${record.window}`;
}

/**
 * Extracts mentions from freshly fetched items and merges the resulting
 * evidence into a copy of the corpus.
 *
 * Never mutates the corpus it is given: the loaded corpus is what a reload
 * restores to, and an ad-hoc fetch is an addition to this session's view rather
 * than an edit to the published data.
 */
export function mergeAdhocItems(
  corpus: Corpus,
  items: SourceItem[],
  dictionary: Dictionary = corpusDictionary(corpus.games),
): MergeResult {
  const newRecords = new Map<string, EvidenceRecord[]>();

  for (const item of items) {
    // The title carries the mention as often as the body does, and both are
    // discarded the moment extraction has read them (KTD11).
    const mentions = extractMentions(`${item.thread.title}\n${item.text}`, dictionary);
    const seen = new Set<string>();

    for (const mention of mentions) {
      if (seen.has(mention.gameId)) continue;
      seen.add(mention.gameId);

      const record: EvidenceRecord = {
        source: item.source,
        community: item.community,
        thread: item.thread,
        window: item.window,
        rankPosition: item.rankPosition,
        postedAt: item.postedAt,
        mention: mention.surface,
        gameId: mention.gameId,
        ...(item.engagement ? { engagement: item.engagement } : {}),
      };
      const existing = newRecords.get(mention.gameId);
      if (existing) existing.push(record);
      else newRecords.set(mention.gameId, [record]);
    }
  }

  let added = 0;
  let gamesTouched = 0;

  const games = corpus.games.map((game) => {
    const incoming = newRecords.get(game.id);
    if (!incoming) return game;

    // Seeded with what the game already carries, then extended as records are
    // accepted — so a batch that contains the same record twice contributes it
    // once. Pulling every window at once makes that ordinary: a thread inside
    // the six-month cutoff is legitimately returned by more than one window.
    const known = new Set(game.evidence.map(evidenceKey));
    const fresh: EvidenceRecord[] = [];
    for (const record of incoming) {
      const key = evidenceKey(record);
      if (known.has(key)) continue;
      known.add(key);
      fresh.push(record);
    }
    if (fresh.length === 0) return game;

    added += fresh.length;
    gamesTouched += 1;
    return { ...game, evidence: [...game.evidence, ...fresh] };
  });

  return { corpus: { ...corpus, games }, added, gamesTouched };
}
