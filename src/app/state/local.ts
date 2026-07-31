import { z } from 'zod';
import { PLATFORMS, RANKING_WINDOWS, SCHEMA_VERSION, SOURCE_IDS } from '../../corpus/schema.js';
import {
  COMMUNITY_TIERS,
  COVERAGE_VALUES,
  CURATED_COMMUNITIES,
  RECOMMENDED_COMMUNITIES,
} from '../../communities/catalogue.js';
import { DEFAULT_FILTERS } from '../filters/apply.js';
import { ANY } from '../filters/genres.js';
import type { SourceId } from '../../corpus/schema.js';
import type { CommunityRef } from '../../communities/catalogue.js';

/**
 * Everything GRS remembers about a reader, held on their device.
 *
 * Accounts are out of scope, so this is the whole of it (KTD10). The store is
 * keyed to the corpus schema version: reader state describes a corpus shape,
 * and a corpus generation it cannot describe is better discarded than
 * misapplied — a stale dismissal list keyed to ids that no longer mean the same
 * thing would hide the wrong games.
 */

const readerCommunitySchema = z.object({
  id: z.string().min(1),
  source: z.enum(['reddit', 'lemmy']),
  label: z.string().min(1),
  covers: z.array(z.enum(COVERAGE_VALUES)),
  tier: z.enum(COMMUNITY_TIERS),
}) satisfies z.ZodType<CommunityRef>;

const filtersSchema = z.object({
  mode: z.enum(['hiddenGems', 'top', 'mostDiscussed', 'breakout', 'rising']),
  window: z.enum(RANKING_WINDOWS),
  platform: z.union([z.literal(ANY), z.enum(PLATFORMS)]),
  handheldOnly: z.boolean(),
  genre: z.string(),
  tag: z.string(),
});

export const readerStateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  /** Games the reader has removed from every future ranking (R24, AE6). */
  dismissedGameIds: z.array(z.string()),
  /** Sources whose evidence still counts (R9, AE5). */
  enabledSources: z.array(z.enum(SOURCE_IDS)),
  /**
   * Communities switched off. Stored as the exception rather than the
   * selection, because the catalogue and the corpus both grow: a new community
   * should arrive enabled rather than silently missing from a saved list.
   */
  disabledCommunities: z.array(z.string()),
  /** Catalogue communities the reader has switched on beyond the defaults (R2). */
  enabledRecommended: z.array(z.string()),
  /** Communities the reader added by hand (R3). */
  addedCommunities: z.array(readerCommunitySchema),
  filters: filtersSchema,
  /**
   * Whether the reader has been told what the default lens is. Defaulted rather
   * than required so adding it does not invalidate state saved before it
   * existed — a reader losing their dismissals to a copy change would be absurd.
   */
  introSeen: z.boolean().default(false),
});

export type ReaderState = z.infer<typeof readerStateSchema>;

export const DEFAULT_READER_STATE: ReaderState = {
  schemaVersion: SCHEMA_VERSION,
  dismissedGameIds: [],
  enabledSources: [...SOURCE_IDS],
  disabledCommunities: [],
  enabledRecommended: [],
  addedCommunities: [],
  filters: DEFAULT_FILTERS,
  introSeen: false,
};

const STORAGE_KEY = `grs:reader:v${SCHEMA_VERSION}`;

/**
 * A reader-supplied identifier, normalized to the form its adapter expects.
 * Returns null when it could not be one (R3 accepts arbitrary communities, not
 * arbitrary text).
 */
export function parseCommunityInput(raw: string): CommunityRef | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Accept what people actually paste: a URL, `/r/name`, `r/name`, or `name`.
  const redditUrl = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)?reddit\.com\/r\/([A-Za-z0-9_]{2,21})\/?/i;
  const redditMatch = redditUrl.exec(trimmed) ?? /^\/?r\/([A-Za-z0-9_]{2,21})$/.exec(trimmed);
  if (redditMatch?.[1]) {
    const name = redditMatch[1];
    return {
      id: `r/${name}`,
      source: 'reddit',
      label: name,
      covers: [],
      tier: 'recommended',
    };
  }

  const lemmyMatch = /^(?:c\/)?([a-z0-9_]{2,50})$/i.exec(trimmed);
  if (lemmyMatch?.[1]) {
    const name = lemmyMatch[1].toLowerCase();
    return { id: name, source: 'lemmy', label: name, covers: [], tier: 'recommended' };
  }

  return null;
}

/**
 * Communities whose evidence must not count, as ranking's `disabledCommunities`
 * expects them.
 *
 * Two different reasons land here. A curated community is on until the reader
 * switches it off. A recommended one is the reverse: the ingest sweeps the whole
 * catalogue, because a scheduled job cannot see which communities a particular
 * reader opted into — so its evidence is in the corpus either way, and the
 * opt-in is what decides whether it counts. Expressing both as one exclusion
 * list is what makes switching a recommended community on take effect against
 * the corpus already loaded, instead of after the next run.
 */
export function excludedCommunities(state: ReaderState): string[] {
  const notOptedIn = RECOMMENDED_COMMUNITIES.filter(
    (community) => !state.enabledRecommended.includes(community.id),
  ).map((community) => community.id);

  return [...new Set([...state.disabledCommunities, ...notOptedIn])];
}

/** Every community that should currently contribute, in catalogue order. */
export function activeCommunities(state: ReaderState): CommunityRef[] {
  const opted = RECOMMENDED_COMMUNITIES.filter((community) =>
    state.enabledRecommended.includes(community.id),
  );
  return [...CURATED_COMMUNITIES, ...opted, ...state.addedCommunities].filter(
    (community) => !state.disabledCommunities.includes(community.id),
  );
}

export interface ReaderStore {
  read(): string | null;
  write(value: string): void;
}

export function memoryReaderStore(initial: string | null = null): ReaderStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

/**
 * Browser-backed store. Every access is guarded: private mode, a full quota and
 * a disabled storage API all mean "this reader has no saved state", which is a
 * first run — never a failed load.
 */
export function localReaderStore(storage: Storage = localStorage): ReaderStore {
  return {
    read: () => {
      try {
        return storage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write: (value) => {
      try {
        storage.setItem(STORAGE_KEY, value);
      } catch {
        /* an unsaveable preference still applies for this session */
      }
    },
  };
}

/**
 * Reads saved state, falling back to defaults for anything unreadable.
 *
 * Reader state is a convenience, never a gate: corrupt or superseded state
 * produces a first-run experience rather than an error the reader has to clear.
 */
export function loadReaderState(store: ReaderStore): ReaderState {
  const raw = store.read();
  if (raw === null) return DEFAULT_READER_STATE;

  try {
    const parsed = readerStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_READER_STATE;
    return parsed.data;
  } catch {
    return DEFAULT_READER_STATE;
  }
}

export function saveReaderState(store: ReaderStore, state: ReaderState): void {
  store.write(JSON.stringify(state));
}

export function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function toggleSource(state: ReaderState, source: SourceId): ReaderState {
  return { ...state, enabledSources: toggleInList(state.enabledSources, source) };
}
