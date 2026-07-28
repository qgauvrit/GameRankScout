import { extractMentions } from '../extract/mentions.js';
import { normalizeTitle } from '../extract/dictionary.js';
import type { Dictionary } from '../extract/dictionary.js';
import type { MetadataCache } from './cache.js';
import type {
  EvidenceRecord,
  GameEntry,
  Handheld,
  OwnerBand,
  Platform,
  SourceItem,
  WindowWeights,
} from '../corpus/schema.js';
import { RANKING_WINDOWS } from '../corpus/schema.js';
import type { DECK_CATEGORIES, PROTON_TIERS } from '../corpus/schema.js';

export interface SteamAppDetails {
  name: string;
  /** Steam's own classification; only `game` is ranked. */
  type: string;
  genres: string[];
  platforms: { windows: boolean; mac: boolean; linux: boolean };
}

export interface SteamSpyDetails {
  tags: string[];
  ownerBand: OwnerBand;
  reviews: number;
}

export type DeckCategory = (typeof DECK_CATEGORIES)[number];
export type ProtonTier = (typeof PROTON_TIERS)[number];

export interface EnrichDeps {
  cache: MetadataCache;
  fetchAppDetails(appid: number): Promise<SteamAppDetails | null>;
  fetchSteamSpy(appid: number): Promise<SteamSpyDetails | null>;
  fetchDeckReport(appid: number): Promise<DeckCategory | null>;
  fetchProtonTier(appid: number): Promise<ProtonTier | null>;
  searchStore(name: string): Promise<{ id: number; name: string } | null>;
  /**
   * Console and cross-platform coverage. Optional by design (D3): it is the one
   * credentialed source, and its absence degrades console metadata rather than
   * failing the run.
   */
  fetchConsolePlatforms?(name: string): Promise<Platform[]>;
}

/**
 * Matches the shape of the ranking's fusion term, so a window weight and a
 * fusion contribution are on the same scale and momentum stays interpretable.
 */
const RRF_K = 60;

function emptyWeights(): WindowWeights {
  return { week: 0, month: 0, sixMonths: 0, year: 0 };
}

/**
 * Turns source items into evidence records by extracting the games each one
 * mentions. One item can name several games and so becomes several records.
 *
 * The item's body text is read here and then dropped: what survives into
 * evidence is the game reference, the thread reference and the surface form
 * that matched, never the post or comment body (KTD11).
 */
export function buildEvidence(items: SourceItem[], dictionary: Dictionary): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];

  for (const item of items) {
    for (const mention of extractMentions(item.text, dictionary)) {
      records.push({
        source: item.source,
        community: item.community,
        thread: item.thread,
        window: item.window,
        rankPosition: item.rankPosition,
        postedAt: item.postedAt,
        mention: mention.surface,
        gameId: mention.gameId,
        ...(item.engagement ? { engagement: item.engagement } : {}),
      });
    }
  }

  return records;
}

function steamAppId(gameId: string): number | null {
  const match = /^steam:(\d+)$/.exec(gameId);
  return match ? Number(match[1]) : null;
}

function toPlatforms(details: SteamAppDetails | null): Platform[] {
  // Steam only reports desktop targets; consoles come from the credentialed
  // source, and its absence must not imply a game is PC-only by assertion.
  if (!details) return [];
  return details.platforms.windows || details.platforms.mac || details.platforms.linux
    ? ['pc']
    : [];
}

interface ResolvedMetadata {
  name: string;
  genres: string[];
  tags: string[];
  platforms: Platform[];
  ownerBand: OwnerBand | null;
  reviewCount: number | null;
  handheld: Handheld | null;
  storeUrl: string | null;
  isGame: boolean;
}

async function resolveMetadata(
  appid: number,
  fallbackName: string,
  deps: EnrichDeps,
): Promise<ResolvedMetadata> {
  const cacheKey = `steam:${appid}`;
  const cached = await deps.cache.get<ResolvedMetadata>(cacheKey);
  if (cached) return cached;

  const [details, spy, deck, proton] = await Promise.all([
    deps.fetchAppDetails(appid).catch(() => null),
    deps.fetchSteamSpy(appid).catch(() => null),
    deps.fetchDeckReport(appid).catch(() => null),
    deps.fetchProtonTier(appid).catch(() => null),
  ]);

  const platforms = toPlatforms(details);

  // Console coverage is best-effort: a missing or failing credentialed source
  // degrades this field and nothing else.
  if (deps.fetchConsolePlatforms) {
    try {
      const consoles = await deps.fetchConsolePlatforms(details?.name ?? fallbackName);
      for (const platform of consoles) {
        if (!platforms.includes(platform)) platforms.push(platform);
      }
    } catch {
      /* degraded console metadata, successful run */
    }
  }

  const handheld: Handheld | null =
    deck || proton ? { deck: deck ?? 'unknown', protonTier: proton ?? null } : null;

  const resolved: ResolvedMetadata = {
    name: details?.name ?? fallbackName,
    genres: details?.genres ?? [],
    tags: spy?.tags ?? [],
    platforms,
    ownerBand: spy?.ownerBand ?? null,
    reviewCount: spy?.reviews ?? null,
    handheld,
    storeUrl: `https://store.steampowered.com/app/${appid}/`,
    // A soundtrack or DLC shares the catalogue but is not a game to rank.
    isGame: details === null ? true : details.type === 'game',
  };

  await deps.cache.set(cacheKey, resolved);
  return resolved;
}

/**
 * Groups evidence by canonical game and attaches the metadata that filtering,
 * obscurity and store links depend on.
 *
 * Metadata is fetched only for games that actually appear in evidence (KTD9),
 * and cached, so a run costs one round of lookups per newly-seen game rather
 * than per mention.
 */
export async function enrichGames(
  evidence: EvidenceRecord[],
  deps: EnrichDeps,
): Promise<GameEntry[]> {
  // Group first, so an unresolved name is searched once rather than per mention.
  const groups = new Map<string, { gameId: string | null; mention: string; records: EvidenceRecord[] }>();

  for (const record of evidence) {
    // Unresolved mentions group by normalized surface form, so "TUNIC" and
    // "Tunic" do not become two entries before resolution has a chance to run.
    const key = record.gameId ?? `name:${normalizeTitle(record.mention)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.records.push(record);
    } else {
      groups.set(key, { gameId: record.gameId, mention: record.mention, records: [record] });
    }
  }

  const byGameId = new Map<string, GameEntry>();

  for (const group of groups.values()) {
    let appid = group.gameId ? steamAppId(group.gameId) : null;
    let canonicalId = group.gameId;

    // A mention the dictionary could not resolve gets one catalogue search.
    if (appid === null) {
      const found = await deps.searchStore(group.mention).catch(() => null);
      if (found) {
        appid = found.id;
        canonicalId = `steam:${found.id}`;
      }
    }

    const metadata =
      appid !== null ? await resolveMetadata(appid, group.mention, deps) : null;

    if (metadata && !metadata.isGame) continue;

    const id = canonicalId ?? `name:${normalizeTitle(group.mention)}`;

    const entry: GameEntry = byGameId.get(id) ?? {
      id,
      name: metadata?.name ?? group.mention,
      storeLinks: metadata?.storeUrl
        ? [{ store: 'steam' as const, url: metadata.storeUrl }]
        : [],
      tags: metadata?.tags ?? [],
      genres: metadata?.genres ?? [],
      platforms: metadata?.platforms ?? [],
      ownerBand: metadata?.ownerBand ?? null,
      reviewCount: metadata?.reviewCount ?? null,
      handheld: metadata?.handheld ?? null,
      windowWeights: emptyWeights(),
      evidence: [],
    };

    for (const record of group.records) {
      // Rewrite the record's game id to the canonical one it resolved to.
      entry.evidence.push({ ...record, gameId: id });
      entry.windowWeights[record.window] += 1 / (RRF_K + record.rankPosition);
    }

    byGameId.set(id, entry);
  }

  // Round weights so a corpus is byte-stable across runs with identical input.
  for (const entry of byGameId.values()) {
    for (const window of RANKING_WINDOWS) {
      entry.windowWeights[window] = Number(entry.windowWeights[window].toFixed(6));
    }
  }

  return [...byGameId.values()];
}
