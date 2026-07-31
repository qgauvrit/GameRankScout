import { XMLParser } from 'fast-xml-parser';

/**
 * Shared XML plumbing for the feed-based adapters.
 *
 * Reddit and itch.io both publish XML, and both need the same three things:
 * a parser configured to leave entities alone, a way to decode those entities
 * afterwards, and a way to read a text node whether the parser handed back a
 * string or a wrapper object. Those had been copied between the two files
 * verbatim, carrying Reddit's rationale into the itch.io parser along with
 * them — the kind of duplication that silently drifts apart.
 */

/**
 * Entity decoding is deliberately not the parser's job. It aborts a document
 * whose text nodes carry more than ~1000 entities, which a real full-size feed
 * routinely exceeds, and `entityExpansionLimit` does not lift that ceiling in
 * v4. Decoding here is needed regardless, because Reddit double-escapes HTML
 * inside XML and so needs two passes.
 */
export function createFeedParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    parseTagValue: false,
    trimValues: true,
  });
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The parser no longer decodes entities, so callers decode here. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** Reads a text node, whether the parser produced a string or a wrapper object. */
export function nodeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const inner = (value as Record<string, unknown>)['#text'];
    if (inner !== undefined && inner !== null) return String(inner);
  }
  return '';
}
