import { XMLParser } from 'fast-xml-parser';
import type { RankingWindow, SourceItem } from '../corpus/schema.js';

/**
 * itch.io publishes one flat catalogue feed rather than per-community
 * discussion, so every item is attributed to a single pseudo-community.
 */
export const ITCH_COMMUNITY = 'itch.io';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const inner = (value as Record<string, unknown>)['#text'];
    if (inner !== undefined && inner !== null) return String(inner);
  }
  return '';
}

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
      const link = text(item.link) || text(item.guid);
      if (!link || !/^https?:\/\//i.test(link)) return [];

      // The decorated <title> appends price and platform tags — "NAME [Free]
      // [Windows]" — which would otherwise reach the extractor as part of the
      // game's name. <plainTitle> is the undecorated form.
      const title = text(item.plainTitle) || text(item.title);
      if (!title) return [];

      const published = text(item.pubDate) || text(item.createDate);
      const parsed = published ? Date.parse(published) : Number.NaN;

      return [
        {
          source: 'itch',
          community: ITCH_COMMUNITY,
          thread: { id: text(item.guid) || link, title, permalink: link },
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
  userAgent?: string;
  feedUrl?: string;
}

export function createItchClient(options: ItchClientOptions = {}) {
  const {
    fetchImpl = fetch,
    userAgent = 'GameRankScout/0.1 (+https://github.com/qgauvrit/GameRankScout)',
    feedUrl = 'https://itch.io/games/newest.xml',
  } = options;

  return {
    async fetchFeed(window: RankingWindow): Promise<SourceItem[]> {
      const response = await fetchImpl(feedUrl, {
        headers: { 'user-agent': userAgent, accept: 'application/rss+xml' },
      });
      if (!response.ok) {
        throw new Error(`itch.io request failed with HTTP ${response.status}`);
      }
      return parseItchFeed(await response.text(), { window });
    },
  };
}
