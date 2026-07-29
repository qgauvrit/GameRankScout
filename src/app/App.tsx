import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCorpus, localStorageStore, CorpusUnavailableError } from './corpus.js';
import { Ranking } from './views/Ranking.js';
import { FilterBar } from './filters/FilterBar.js';
import { DEFAULT_FILTERS, applyRanking } from './filters/apply.js';
import { frequentTags } from './filters/tags.js';
import { Settings } from './settings/Settings.js';
import {
  DEFAULT_READER_STATE,
  loadReaderState,
  localReaderStore,
  saveReaderState,
} from './state/local.js';
import { AdhocUnavailableError, fetchAdhocCommunity } from './adhoc/client.js';
import { mergeAdhocItems } from './adhoc/merge.js';
import { WINDOW_LABELS, sourceLabel } from './labels.js';
import type { LoadedCorpus } from './corpus.js';
import type { Filters } from './filters/apply.js';
import type { ReaderState } from './state/local.js';
import type { CommunityRef } from '../communities/catalogue.js';

const CORPUS_URL = '/corpus.json';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; loaded: LoadedCorpus }
  | { status: 'unavailable'; error: unknown };

/** How the on-demand pull for one added community is going. */
export type AdhocState =
  | { status: 'loading' }
  | { status: 'merged'; added: number }
  | { status: 'failed'; reason: 'not_found' | 'invalid' | 'unreachable' };

function formatFreshness(generatedAt: string): string {
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) return 'unknown';
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 1) return 'updated just now';
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showSettings, setShowSettings] = useState(false);
  const [adhoc, setAdhoc] = useState<Record<string, AdhocState>>({});
  // Read once at mount: the store is this tab's own, so re-reading it would only
  // risk clobbering an edit made a moment ago.
  const [reader, setReader] = useState<ReaderState>(() =>
    typeof localStorage === 'undefined' ? DEFAULT_READER_STATE : loadReaderState(localReaderStore()),
  );
  const corpus = state.status === 'ready' ? state.loaded.corpus : null;

  // Persisting from an effect rather than from each setter keeps every path
  // that changes reader state saved, including ones added later.
  useEffect(() => {
    if (typeof localStorage !== 'undefined') saveReaderState(localReaderStore(), reader);
  }, [reader]);

  const setFilters = useCallback(
    (filters: Filters) => setReader((current) => ({ ...current, filters })),
    [],
  );

  const dismissGame = useCallback((gameId: string) => {
    setReader((current) =>
      current.dismissedGameIds.includes(gameId)
        ? current
        : { ...current, dismissedGameIds: [...current.dismissedGameIds, gameId] },
    );
  }, []);

  /**
   * Pulls a community the scheduled ingest has not covered and folds it into
   * this session's corpus, so adding one changes the ranking now rather than
   * after the next run (R8, F3). The merge is deliberately not written back to
   * the offline cache: what a reload restores to should be the published
   * corpus, not one session's additions.
   */
  const pullCommunity = useCallback(
    async (community: CommunityRef) => {
      if (!corpus) return;
      setAdhoc((current) => ({ ...current, [community.id]: { status: 'loading' } }));
      try {
        const items = await fetchAdhocCommunity(community, reader.filters.window);
        const merged = mergeAdhocItems(corpus, items);
        setState((current) =>
          current.status === 'ready'
            ? { ...current, loaded: { ...current.loaded, corpus: merged.corpus } }
            : current,
        );
        setAdhoc((current) => ({
          ...current,
          [community.id]: { status: 'merged', added: merged.added },
        }));
      } catch (error) {
        setAdhoc((current) => ({
          ...current,
          [community.id]: {
            status: 'failed',
            reason: error instanceof AdhocUnavailableError ? error.reason : 'unreachable',
          },
        }));
      }
    },
    [corpus, reader.filters.window],
  );

  const tags = useMemo(() => frequentTags(corpus?.games ?? []), [corpus]);

  // Filtering and ranking are pure functions over the loaded corpus (R29), so a
  // filter change is a recompute rather than a round trip — which is what lets
  // the ranking re-render with no loading state in between (R32).
  const result = useMemo(
    () =>
      applyRanking(corpus?.games ?? [], reader.filters, {
        enabledSources: reader.enabledSources,
        disabledCommunities: reader.disabledCommunities,
        dismissedGameIds: reader.dismissedGameIds,
      }),
    [corpus, reader],
  );

  const load = useCallback(() => {
    setState({ status: 'loading' });
    loadCorpus({ url: CORPUS_URL, store: localStorageStore() })
      .then((loaded) => setState({ status: 'ready', loaded }))
      .catch((error: unknown) => setState({ status: 'unavailable', error }));
  }, []);

  useEffect(load, [load]);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="state">
          <div className="glyph spinning" />
          <h2>Reading the room</h2>
          <p>Pulling in what communities have been discussing.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    const offline = state.error instanceof CorpusUnavailableError;
    return (
      <div className="app">
        <div className="state">
          <div className="glyph" />
          <h2>{offline ? 'Nothing cached yet' : 'Could not load the rankings'}</h2>
          <p>
            {offline
              ? 'GameRankScout works offline once it has loaded a ranking, but it needs a connection the first time.'
              : 'The ranking data could not be read. This is usually temporary.'}
          </p>
          <button type="button" className="button" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { corpus: loadedCorpus, origin } = state.loaded;
  const failedSources = loadedCorpus.sources.filter((source) => !source.ok);

  if (showSettings) {
    return (
      <div className="app">
        <Settings
          state={reader}
          onChange={setReader}
          corpus={loadedCorpus}
          adhoc={adhoc}
          onPull={pullCommunity}
          onClose={() => setShowSettings(false)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>GameRankScout</h1>
        <div className="masthead-end">
          <span className="freshness">{formatFreshness(loadedCorpus.generatedAt)}</span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
          >
            <span aria-hidden="true">☰</span>
          </button>
        </div>
      </header>

      {origin === 'cache' && (
        <p className="notice">
          <span aria-hidden="true">◍</span>
          <span>
            <strong>Showing the last ranking you loaded.</strong> You are offline, so this may be
            behind what communities are discussing now.
          </span>
        </p>
      )}

      {failedSources.length > 0 && (
        <p className="notice">
          <span aria-hidden="true">◍</span>
          <span>
            <strong>
              {failedSources.map((source) => sourceLabel(source.source)).join(', ')} did not respond
              during the last update.
            </strong>{' '}
            The ranking is built from the sources that did, so it is thinner than usual.
          </span>
        </p>
      )}

      {loadedCorpus.games.length === 0 ? (
        <div className="state">
          <div className="glyph" />
          <h2>No games ranked yet</h2>
          <p>
            The last update finished without finding enough discussion to rank. The next scheduled
            run will try again.
          </p>
        </div>
      ) : (
        <>
          <FilterBar filters={reader.filters} onChange={setFilters} tags={tags} />

          {result.relaxedFrom && (
            <p className="notice" role="status">
              <span aria-hidden="true">◍</span>
              <span>
                <strong>Not much matched in the {WINDOW_LABELS[result.relaxedFrom].toLowerCase()}.</strong>{' '}
                Widened the timeframe to the {WINDOW_LABELS[result.window].toLowerCase()} — every
                other filter is untouched.
              </span>
            </p>
          )}

          {result.exhausted ? (
            <div className="state">
              <div className="glyph" />
              <h2>Nothing matches those filters</h2>
              <p>
                No game in this corpus fits that combination at any timeframe. Widening it further
                would not help — there is genuinely nothing there.
              </p>
              <button type="button" className="button" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset filters
              </button>
            </div>
          ) : (
            <Ranking ranked={result.ranked} onDismiss={dismissGame} />
          )}
        </>
      )}
    </div>
  );
}
