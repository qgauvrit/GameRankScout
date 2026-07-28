import type { EnrichDeps, SteamAppDetails, SteamSpyDetails, DeckCategory, ProtonTier } from './resolve.js';
import type { OwnerBand } from '../corpus/schema.js';

/**
 * Steam's Deck compatibility verdicts, as the report's numeric category.
 * Valve does not document these; they were read off live reports.
 */
const DECK_CATEGORY_BY_CODE: Record<number, DeckCategory> = {
  0: 'unknown',
  1: 'unsupported',
  2: 'playable',
  3: 'verified',
};

const PROTON_TIER_VALUES = new Set<string>([
  'platinum',
  'gold',
  'silver',
  'bronze',
  'borked',
  'pending',
]);

export function parseOwners(owners: string | undefined): OwnerBand | null {
  if (!owners) return null;
  const numbers = owners.match(/[\d,]+/g);
  if (!numbers?.length) return null;
  const parsed = numbers.map((n) => Number(n.replace(/,/g, '')));
  return { min: parsed[0] ?? 0, max: parsed[parsed.length - 1] ?? parsed[0] ?? 0 };
}

export function parseAppDetails(payload: unknown, appid: number): SteamAppDetails | null {
  const entry = (payload as Record<string, { success?: boolean; data?: Record<string, unknown> }>)?.[
    String(appid)
  ];
  if (!entry?.success || !entry.data) return null;

  const data = entry.data;
  const platforms = (data.platforms ?? {}) as Record<string, unknown>;
  const genres = Array.isArray(data.genres)
    ? (data.genres as Array<{ description?: unknown }>)
        .map((g) => (typeof g.description === 'string' ? g.description : null))
        .filter((g): g is string => g !== null)
    : [];

  return {
    name: typeof data.name === 'string' ? data.name : '',
    type: typeof data.type === 'string' ? data.type : 'game',
    genres,
    platforms: {
      windows: platforms.windows === true,
      mac: platforms.mac === true,
      linux: platforms.linux === true,
    },
  };
}

export function parseSteamSpy(payload: unknown): SteamSpyDetails | null {
  const data = payload as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return null;
  if (typeof data.appid !== 'number') return null;

  // Tags arrive as an object of tag -> vote count, ordered most-voted first.
  const rawTags = data.tags;
  const tags =
    rawTags && typeof rawTags === 'object' && !Array.isArray(rawTags)
      ? Object.keys(rawTags as Record<string, number>)
      : [];

  const positive = typeof data.positive === 'number' ? data.positive : 0;
  const negative = typeof data.negative === 'number' ? data.negative : 0;

  return {
    tags,
    ownerBand: parseOwners(typeof data.owners === 'string' ? data.owners : undefined) ?? {
      min: 0,
      max: 0,
    },
    reviews: positive + negative,
  };
}

export function parseDeckReport(payload: unknown): DeckCategory | null {
  const body = payload as { success?: unknown; results?: { resolved_category?: unknown } } | null;
  if (!body || body.success !== 1) return null;
  const code = body.results?.resolved_category;
  if (typeof code !== 'number') return null;
  return DECK_CATEGORY_BY_CODE[code] ?? 'unknown';
}

export function parseProtonSummary(payload: unknown): ProtonTier | null {
  const tier = (payload as { tier?: unknown } | null)?.tier;
  return typeof tier === 'string' && PROTON_TIER_VALUES.has(tier) ? (tier as ProtonTier) : null;
}

export function parseStoreSearch(
  payload: unknown,
  query: string,
): { id: number; name: string } | null {
  const items = (payload as { items?: Array<{ id?: unknown; name?: unknown; type?: unknown }> })
    ?.items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const normalized = query.trim().toLowerCase();
  const candidates = items.filter(
    (item) => typeof item.id === 'number' && typeof item.name === 'string',
  ) as Array<{ id: number; name: string; type?: unknown }>;

  // Search is fuzzy and will happily return a sequel or a soundtrack for an
  // exact title, so an exact name match wins over the first result.
  const exact = candidates.find((item) => item.name.trim().toLowerCase() === normalized);
  const chosen = exact ?? candidates[0];
  return chosen ? { id: chosen.id, name: chosen.name } : null;
}

export interface HttpDepsOptions {
  fetchImpl?: typeof fetch;
  /** Spacing between Steam requests; the storefront throttles aggressively. */
  minIntervalMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  userAgent?: string;
  /** Supplied only when Twitch credentials are configured (D3). */
  fetchConsolePlatforms?: EnrichDeps['fetchConsolePlatforms'];
}

/**
 * Builds the live metadata fetchers. Every one returns null rather than
 * throwing on an unusable response, so a single missing lookup degrades one
 * field instead of failing the run.
 */
export function createHttpEnrichers(
  cache: EnrichDeps['cache'],
  options: HttpDepsOptions = {},
): EnrichDeps {
  const {
    fetchImpl = fetch,
    minIntervalMs = 1_500,
    sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    nowImpl = () => Date.now(),
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
  } = options;

  let lastRequestAt: number | null = null;

  async function getJson(url: string): Promise<unknown | null> {
    if (lastRequestAt !== null) {
      const elapsed = nowImpl() - lastRequestAt;
      if (elapsed < minIntervalMs) await sleepImpl(minIntervalMs - elapsed);
    }
    lastRequestAt = nowImpl();

    try {
      const response = await fetchImpl(url, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
      });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  }

  return {
    cache,
    async fetchAppDetails(appid) {
      const payload = await getJson(
        `https://store.steampowered.com/api/appdetails?appids=${appid}`,
      );
      return payload ? parseAppDetails(payload, appid) : null;
    },
    async fetchSteamSpy(appid) {
      const payload = await getJson(
        `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
      );
      return payload ? parseSteamSpy(payload) : null;
    },
    async fetchDeckReport(appid) {
      const payload = await getJson(
        `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}`,
      );
      return payload ? parseDeckReport(payload) : null;
    },
    async fetchProtonTier(appid) {
      const payload = await getJson(
        `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`,
      );
      return payload ? parseProtonSummary(payload) : null;
    },
    async searchStore(name) {
      const payload = await getJson(
        `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`,
      );
      return payload ? parseStoreSearch(payload, name) : null;
    },
    ...(options.fetchConsolePlatforms
      ? { fetchConsolePlatforms: options.fetchConsolePlatforms }
      : {}),
  };
}
