import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCorpus, localStorageStore, CorpusUnavailableError } from './corpus.js';
import { Ranking } from './views/Ranking.js';
import { FilterBar } from './filters/FilterBar.js';
import { DEFAULT_FILTERS, applyRanking, momentumAvailable } from './filters/apply.js';
import { frequentTags } from './filters/tags.js';
import { Settings } from './settings/Settings.js';
import {
  DEFAULT_READER_STATE,
  excludedCommunities,
  loadReaderState,
  localReaderStore,
  saveReaderState,
} from './state/local.js';
import { AdhocUnavailableError, fetchAdhocCommunity } from './adhoc/client.js';
import { mergeAdhocItems } from './adhoc/merge.js';
import { MODE_LABELS, WINDOW_LABELS, sourceLabel } from './labels.js';
import { RANKING_WINDOWS } from '../corpus/schema.js';
import * as stylex from '@stylexjs/stylex';
import { Button, EmptyState, Heading, IconButton, Spinner, Stack, Text } from '@astryxdesign/core';
import { StatusLine, type StatusItem } from './views/StatusLine.js';
import type { LoadedCorpus } from './corpus.js';
import type { Filters } from './filters/apply.js';
import type { ReaderState } from './state/local.js';
import type { CommunityRef } from '../communities/catalogue.js';
import type { AdhocState } from './adhoc/client.js';

const CORPUS_URL = '/corpus.json';

/** The page container: a single centred reading column that fills the viewport. */
const styles = stylex.create({
  app: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100dvh',
    maxWidth: '46rem',
    marginInline: 'auto',
    paddingInline: '1rem',
    // Give the masthead room from the viewport top; on a notched device clear
    // the status bar instead of tucking under it.
    paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  // A 44px square hit area for the icon-only Settings control, applied locally
  // via `xstyle` so only this touch-first control grows rather than every
  // IconButton in the app (KTD2). The design system renders these at 32px.
  touchTargetSquare: {
    minBlockSize: 44,
    minInlineSize: 44,
  },
});

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; loaded: LoadedCorpus }
  | { status: 'unavailable'; error: unknown };

/**
 * Whether the device thinks it has a network.
 *
 * Needed separately from where the corpus came from: the service worker answers
 * from its own cache, so a corpus can arrive looking like a fresh fetch while
 * the device is in a tunnel. Without this the reader is never told the ranking
 * has stopped refreshing — which is the whole point of the offline state (R35).
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

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
  const online = useOnline();
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
  /** Communities already fetched for the loaded corpus, so nothing pulls twice. */
  const pulled = useRef<Set<string>>(new Set());

  const pullCommunity = useCallback(
    async (community: CommunityRef) => {
      if (!corpus) return;
      const pullKey = `${corpus.generatedAt}:${community.id}`;
      if (pulled.current.has(pullKey)) return;
      pulled.current.add(pullKey);
      setAdhoc((current) => ({ ...current, [community.id]: { status: 'loading' } }));
      try {
        // Every window, not just the selected one: a community that contributes
        // to the past week and vanishes when the reader switches to the past
        // year is not really in the ranking, it is in one view of it.
        const settled = await Promise.allSettled(
          RANKING_WINDOWS.map((window) => fetchAdhocCommunity(community, window)),
        );
        const failure = settled.find((r) => r.status === 'rejected');
        // Only a total failure is a failure: a community may genuinely have
        // nothing in one window while being active in another.
        if (failure && settled.every((r) => r.status === 'rejected')) throw failure.reason;
        const items = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        // Merge against whatever the corpus is *now*, not the one captured when
        // this pull started. Two overlapping pulls both built on the same
        // snapshot and the second silently discarded the first, while still
        // reporting the mentions it had dropped. mergeAdhocItems is pure and
        // dedupes on evidence key, so composing inside the updater is safe.
        let added = 0;
        setState((current) => {
          if (current.status !== 'ready') return current;
          const merged = mergeAdhocItems(current.loaded.corpus, items);
          added = merged.added;
          return { ...current, loaded: { ...current.loaded, corpus: merged.corpus } };
        });
        setAdhoc((current) => ({
          ...current,
          [community.id]: { status: 'merged', added },
        }));
      } catch (error) {
        // Release the key. It is claimed up front so two loads cannot pull the
        // same community twice, but holding it after a failure makes the
        // failure permanent for the session — and the failures reachable here
        // are transient ones: a rate ceiling that clears in a minute, a source
        // that was briefly unreachable. Nothing retries automatically, so a
        // held key means the reader cannot either.
        pulled.current.delete(pullKey);
        setAdhoc((current) => ({
          ...current,
          [community.id]: {
            status: 'failed',
            reason: error instanceof AdhocUnavailableError ? error.reason : 'unreachable',
          },
        }));
      }
    },
    [corpus],
  );

  /**
   * Re-pull the reader's own communities whenever a corpus loads.
   *
   * The merge is deliberately never written to the offline cache — a reload
   * should restore the published corpus, not one session's additions — which
   * meant an added community worked once and then quietly stopped counting.
   * Fetching again on load is what makes it durable without inventing
   * server-side per-reader state: the addition persists, and its evidence is
   * rebuilt from the source each time.
   */
  useEffect(() => {
    if (!corpus) return;
    // pullCommunity de-duplicates per corpus generation, so a community the
    // reader just added by hand is not fetched a second time here.
    for (const community of reader.addedCommunities) void pullCommunity(community);
  }, [corpus, reader.addedCommunities, pullCommunity]);

  const tags = useMemo(() => frequentTags(corpus?.games ?? []), [corpus]);

  // Filtering and ranking are pure functions over the loaded corpus (R29), so a
  // filter change is a recompute rather than a round trip — which is what lets
  // the ranking re-render with no loading state in between (R32).
  const result = useMemo(
    () =>
      applyRanking(corpus?.games ?? [], reader.filters, {
        enabledSources: reader.enabledSources,
        disabledCommunities: excludedCommunities(reader),
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
      <div {...stylex.props(styles.app)}>
        <EmptyState
          headingLevel={2}
          icon={<Spinner />}
          title="Reading the room"
          description="Pulling in what communities have been discussing."
        />
      </div>
    );
  }

  if (state.status === 'unavailable') {
    const offline = state.error instanceof CorpusUnavailableError;
    return (
      <div {...stylex.props(styles.app)}>
        <EmptyState
          headingLevel={2}
          title={offline ? 'Nothing cached yet' : 'Could not load the rankings'}
          description={
            offline
              ? 'GameRankScout works offline once it has loaded a ranking, but it needs a connection the first time.'
              : 'The ranking data could not be read. This is usually temporary.'
          }
          actions={<Button label="Try again" onClick={load} />}
        />
      </div>
    );
  }

  const { corpus: loadedCorpus, origin } = state.loaded;
  const failedSources = loadedCorpus.sources.filter((source) => !source.ok);

  if (showSettings) {
    return (
      <div {...stylex.props(styles.app)}>
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

  // Active statuses render as visible themed Banners (R6). The offline and
  // failed-source states stand on their own; the momentum and relaxed-timeframe
  // states only apply once there is a ranking to explain.
  const hasRanking = loadedCorpus.games.length > 0;
  const statuses: StatusItem[] = [];

  if (origin === 'cache' || !online) {
    statuses.push({
      key: 'offline',
      tone: 'warning',
      title: 'Showing the last ranking you loaded.',
      description: 'You are offline, so this may be behind what communities are discussing now.',
    });
  }

  if (failedSources.length > 0) {
    statuses.push({
      key: 'failed',
      tone: 'warning',
      title: `${failedSources
        .map((source) => sourceLabel(source.source))
        .join(', ')} did not respond during the last update.`,
      description: 'The ranking is built from the sources that did, so it is thinner than usual.',
    });
  }

  if (hasRanking && !momentumAvailable(loadedCorpus.games, reader.filters.mode)) {
    statuses.push({
      key: 'momentum',
      tone: 'info',
      live: true,
      title: `${MODE_LABELS[reader.filters.mode]} has nothing recent to compare against.`,
      description:
        'The last update did not cover the recent window this mode needs, so these are ranked without any sense of momentum.',
    });
  }

  if (hasRanking && result.relaxedFrom) {
    statuses.push({
      key: 'relaxed',
      tone: 'info',
      live: true,
      title: `Not much matched in the ${WINDOW_LABELS[result.relaxedFrom].toLowerCase()}.`,
      description: `Widened the timeframe to the ${WINDOW_LABELS[
        result.window
      ].toLowerCase()} — every other filter is untouched.`,
    });
  }

  return (
    <div {...stylex.props(styles.app)}>
      <Stack as="header" direction="horizontal" hAlign="between" vAlign="center" gap={2}>
        <Heading level={1}>GameRankScout</Heading>
        <Stack direction="horizontal" vAlign="center" gap={2}>
          <Text type="supporting">{formatFreshness(loadedCorpus.generatedAt)}</Text>
          <IconButton
            label="Settings"
            variant="ghost"
            icon={<span aria-hidden="true">☰</span>}
            xstyle={styles.touchTargetSquare}
            onClick={() => setShowSettings(true)}
          />
        </Stack>
      </Stack>

      <StatusLine statuses={statuses} />

      {loadedCorpus.games.length === 0 ? (
        <EmptyState
          headingLevel={2}
          title="No games ranked yet"
          description="The last update finished without finding enough discussion to rank. The next scheduled run will try again."
        />
      ) : (
        <Stack direction="vertical" gap={4}>
          <FilterBar filters={reader.filters} onChange={setFilters} tags={tags} />

          {result.exhausted ? (
            <EmptyState
              headingLevel={2}
              title="Nothing matches those filters"
              description="No game in this corpus fits that combination at any timeframe. Widening it further would not help — there is genuinely nothing there."
              actions={<Button label="Reset filters" onClick={() => setFilters(DEFAULT_FILTERS)} />}
            />
          ) : (
            <Ranking ranked={result.ranked} onDismiss={dismissGame} />
          )}
        </Stack>
      )}
    </div>
  );
}
