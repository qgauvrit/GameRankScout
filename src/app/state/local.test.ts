import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READER_STATE,
  activeCommunities,
  loadReaderState,
  memoryReaderStore,
  parseCommunityInput,
  saveReaderState,
  toggleSource,
  excludedCommunities,
} from './local.js';
import { CURATED_COMMUNITIES, RECOMMENDED_COMMUNITIES } from '../../communities/catalogue.js';
import { SCHEMA_VERSION, SOURCE_IDS } from '../../corpus/schema.js';

describe('reader state', () => {
  it('starts a first run with everything on and nothing hidden (R31)', () => {
    const state = loadReaderState(memoryReaderStore());

    expect(state.dismissedGameIds).toEqual([]);
    expect(state.enabledSources).toEqual([...SOURCE_IDS]);
    expect(state.disabledCommunities).toEqual([]);
  });

  it('survives a round trip through the store', () => {
    const store = memoryReaderStore();
    const saved = {
      ...DEFAULT_READER_STATE,
      dismissedGameIds: ['steam:1'],
      enabledSources: ['reddit' as const],
      filters: { ...DEFAULT_READER_STATE.filters, window: 'year' as const, genre: 'horror' },
    };

    saveReaderState(store, saved);

    expect(loadReaderState(store)).toEqual(saved);
  });

  it('survives a corpus refresh, because it is keyed to the schema, not the run', () => {
    const store = memoryReaderStore();
    saveReaderState(store, { ...DEFAULT_READER_STATE, dismissedGameIds: ['steam:1'] });

    // A new corpus at the same schema version replaces the games, not the reader.
    expect(loadReaderState(store).dismissedGameIds).toEqual(['steam:1']);
  });

  it('discards state written by a superseded schema version', () => {
    const store = memoryReaderStore(
      JSON.stringify({
        ...DEFAULT_READER_STATE,
        schemaVersion: SCHEMA_VERSION - 1,
        dismissedGameIds: ['steam:1'],
      }),
    );

    // Ids from an older corpus generation cannot be trusted to mean the same
    // game, and a wrong dismissal hides something the reader wanted.
    expect(loadReaderState(store)).toEqual(DEFAULT_READER_STATE);
  });

  it('treats unreadable state as a first run rather than an error', () => {
    expect(loadReaderState(memoryReaderStore('{ truncated'))).toEqual(DEFAULT_READER_STATE);
    expect(loadReaderState(memoryReaderStore('{"schemaVersion":1}'))).toEqual(
      DEFAULT_READER_STATE,
    );
  });

  it('toggles a source off and back on', () => {
    const off = toggleSource(DEFAULT_READER_STATE, 'lemmy');
    expect(off.enabledSources).not.toContain('lemmy');

    expect(toggleSource(off, 'lemmy').enabledSources).toContain('lemmy');
  });
});

describe('active communities', () => {
  it('is the curated set on a first run', () => {
    expect(activeCommunities(DEFAULT_READER_STATE).map((c) => c.id)).toEqual(
      CURATED_COMMUNITIES.map((c) => c.id),
    );
  });

  it('adds a recommended community the reader opted into', () => {
    const opted = RECOMMENDED_COMMUNITIES[0]!;
    const state = { ...DEFAULT_READER_STATE, enabledRecommended: [opted.id] };

    expect(activeCommunities(state).map((c) => c.id)).toContain(opted.id);
  });

  it('drops a community the reader switched off', () => {
    const dropped = CURATED_COMMUNITIES[0]!;
    const state = { ...DEFAULT_READER_STATE, disabledCommunities: [dropped.id] };

    expect(activeCommunities(state).map((c) => c.id)).not.toContain(dropped.id);
  });

  it('includes a community the reader added by hand', () => {
    const state = {
      ...DEFAULT_READER_STATE,
      addedCommunities: [parseCommunityInput('r/emulation')!],
    };

    expect(activeCommunities(state).map((c) => c.id)).toContain('r/emulation');
  });
});

describe('reading a community identifier the reader typed', () => {
  it('accepts the forms people actually paste', () => {
    for (const input of [
      'r/cozygames',
      '/r/cozygames',
      'https://www.reddit.com/r/cozygames',
      'https://old.reddit.com/r/cozygames/',
      'reddit.com/r/cozygames',
    ]) {
      expect(parseCommunityInput(input)).toMatchObject({ id: 'r/cozygames', source: 'reddit' });
    }
  });

  it('reads a bare or c-prefixed name as a Lemmy community', () => {
    expect(parseCommunityInput('c/retrogaming')).toMatchObject({
      id: 'retrogaming',
      source: 'lemmy',
    });
    expect(parseCommunityInput('retrogaming')).toMatchObject({ source: 'lemmy' });
  });

  it('rejects text that is not a community identifier', () => {
    for (const input of ['', '   ', 'r/', 'https://example.com/something', 'two words', 'r/a']) {
      expect(parseCommunityInput(input)).toBeNull();
    }
  });

  it('rejects a Reddit name longer than Reddit allows', () => {
    expect(parseCommunityInput(`r/${'a'.repeat(22)}`)).toBeNull();
  });
});

describe('which communities count', () => {
  it('excludes every recommended community until the reader opts in', () => {
    // The ingest sweeps the whole catalogue because it cannot see a reader's
    // opt-ins, so the opt-in is what decides whether the evidence counts.
    const excluded = excludedCommunities(DEFAULT_READER_STATE);

    for (const community of RECOMMENDED_COMMUNITIES) {
      expect(excluded).toContain(community.id);
    }
    for (const community of CURATED_COMMUNITIES) {
      expect(excluded).not.toContain(community.id);
    }
  });

  it('stops excluding one the reader switched on', () => {
    const opted = RECOMMENDED_COMMUNITIES[0]!;
    const excluded = excludedCommunities({
      ...DEFAULT_READER_STATE,
      enabledRecommended: [opted.id],
    });

    expect(excluded).not.toContain(opted.id);
  });

  it('still excludes a curated community the reader switched off', () => {
    const dropped = CURATED_COMMUNITIES[0]!;
    const excluded = excludedCommunities({
      ...DEFAULT_READER_STATE,
      disabledCommunities: [dropped.id],
    });

    expect(excluded).toContain(dropped.id);
  });
});
