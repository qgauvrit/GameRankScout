import { createFeedParser, decodeEntities, nodeText, toArray } from './xml.js';
import { createPacedFetch } from './pacing.js';
import type { RankingWindow, SourceItem } from '../corpus/schema.js';

/**
 * itch.io publishes one flat catalogue feed rather than per-community
 * discussion, so every item is attributed to a single pseudo-community.
 */
export const ITCH_COMMUNITY = 'itch.io';

const parser = createFeedParser();

interface RawItchItem {
  guid?: unknown;
  link?: unknown;
  title?: unknown;
  plainTitle?: unknown;
  pubDate?: unknown;
  createDate?: unknown;
}

export function parseItchFeed(
  xml: string,
  options: { window: RankingWindow },
): SourceItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: Record<string, unknown> } };
  const items = toArray(doc.rss?.channel?.item as RawItchItem | RawItchItem[] | undefined);

  return items
    .flatMap((item): SourceItem[] => {
      const link = nodeText(item.link) || nodeText(item.guid);
      if (!link || !/^https?:\/\//i.test(link)) return [];

      // The decorated <title> appends price and platform tags — "NAME [Free]
      // [Windows]" — which would otherwise reach the extractor as part of the
      // game's name. <plainTitle> is the undecorated form.
      const title = decodeEntities(nodeText(item.plainTitle) || nodeText(item.title));
      if (!title) return [];

      const published = nodeText(item.pubDate) || nodeText(item.createDate);
      const parsed = published ? Date.parse(published) : Number.NaN;

      return [
        {
          source: 'itch',
          community: ITCH_COMMUNITY,
          thread: { id: nodeText(item.guid) || link, title, permalink: link },
          window: options.window,
          rankPosition: 0, // replaced below
          postedAt: new Date(Number.isNaN(parsed) ? 0 : parsed).toISOString(),
          kind: 'post',
          parentThreadId: null,
          // The title is the whole signal here — itch items carry no discussion.
          text: title,
        },
      ];
    })
    .map((item, index) => ({ ...item, rankPosition: index }));
}

export interface ItchClientOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  minIntervalMs?: number;
  baseBackoffMs?: number;
  maxRetries?: number;
  userAgent?: string;
  feedUrl?: string;
}

export function createItchClient(options: ItchClientOptions = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    nowImpl = () => Date.now(),
    // One flat catalogue feed, fetched once per run, so the spacing only has to
    // keep a retry from arriving on top of the request it is retrying.
    minIntervalMs = 2_000,
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
    feedUrl = 'https://itch.io/games/newest.xml',
  } = options;

  const request = createPacedFetch({
    source: 'itch.io',
    fetchImpl,
    sleepImpl,
    nowImpl,
    minIntervalMs,
    ...(options.baseBackoffMs !== undefined ? { baseBackoffMs: options.baseBackoffMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    headers: { 'user-agent': userAgent, accept: 'application/rss+xml' },
  });

  return {
    async fetchFeed(window: RankingWindow): Promise<SourceItem[]> {
      return parseItchFeed(await request(feedUrl), { window });
    },
    rejections: request.rejections,
  };
}
