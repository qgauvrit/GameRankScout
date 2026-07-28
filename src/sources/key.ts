import type { SourceItem } from '../corpus/schema.js';

/**
 * A globally unique key for one source item.
 *
 * Native identifiers are only unique within a source, and in Lemmy's case only
 * within an instance — two instances number their posts independently. Merging
 * adapters therefore keys on source, community and native id together rather
 * than mangling the native id, which stays intact so links remain reconstructable.
 */
export function sourceItemKey(item: SourceItem): string {
  return `${item.source}:${item.community}:${item.thread.id}`;
}
