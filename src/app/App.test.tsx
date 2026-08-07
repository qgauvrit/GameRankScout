// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { MIN_USEFUL_RESULTS } from './filters/apply.js';
import { serializeCorpus } from '../corpus/schema.js';
import { corpus, evidence, game, sourceStatus } from '../../test/factory.js';
import type { Corpus } from '../corpus/schema.js';

/**
 * These go through the real load path — fetch, validate, cache, rank, render —
 * rather than mocking the corpus in. The failure the app has to survive is a
 * partly-broken run reaching the browser, and that only shows end to end.
 */
function serveCorpus(value: Corpus) {
  const body = serializeCorpus(value);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('renders the ranking once the corpus loads', async () => {
    serveCorpus(
      corpus({
        games: [game({ id: 'steam:1', name: 'Signal Drift' })],
      }),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('surfaces a failed source so a thinned ranking is visible, not silent', async () => {
    serveCorpus(
      corpus({
        games: [game({ id: 'steam:1', name: 'Signal Drift' })],
        sources: [
          sourceStatus({ source: 'reddit', ok: true }),
          sourceStatus({
            source: 'lemmy',
            ok: false,
            evidenceCount: 0,
            communitiesCovered: 0,
            error: 'HTTP 503',
          }),
        ],
      }),
    );

    render(<App />);

    const notice = await screen.findByText(/did not respond during the last update/i);
    expect(notice).toHaveTextContent('Lemmy');
    // Degraded, not broken: the ranking still renders alongside the warning.
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('does not warn about sources when every one succeeded', async () => {
    serveCorpus({
      ...corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }),
      sources: [sourceStatus({ source: 'reddit' }), sourceStatus({ source: 'lemmy' })],
    });

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    expect(screen.queryByText(/did not respond/i)).toBeNull();
  });

  it('reaches a discussion thread from the ranking in one interaction', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            evidence: [
              evidence({
                community: 'r/patientgamers',
                window: 'week',
                thread: {
                  id: 't3_aaa',
                  title: 'Anyone else playing this?',
                  permalink: 'https://reddit.test/comments/aaa/',
                },
              }),
            ],
          }),
        ],
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Signal Drift/i }));

    expect(screen.getByRole('link', { name: /Anyone else playing this/i })).toHaveAttribute(
      'href',
      'https://reddit.test/comments/aaa/',
    );
  });

  it('states the corpus is empty rather than rendering a blank ranking', async () => {
    serveCorpus(corpus({ games: [] }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /no games ranked yet/i })).toBeInTheDocument();
  });

  it('covers AE1: widens the timeframe and says so when a filter combination is sparse', async () => {
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:0',
            name: 'Lonely Week',
            evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
          }),
          ...Array.from({ length: MIN_USEFUL_RESULTS }, (_, index) =>
            game({
              id: `steam:m${index}`,
              name: `Month Game ${index}`,
              evidence: [evidence({ community: 'r/patientgamers', window: 'month' })],
            }),
          ),
        ],
      }),
    );

    render(<App />);

    // The relaxed-timeframe status now lives in the collapsed status line as a
    // single Text element; assert its copy directly. (jsdom does not apply the
    // collapse CSS, so the mounted copy is findable without expanding.)
    expect(await screen.findByText(/not much matched in the past week/i)).toBeInTheDocument();
    expect(screen.getByText(/widened the timeframe to the past month/i)).toBeInTheDocument();
    expect(screen.getByText(/every other filter is untouched/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Month Game 0/i })).toBeInTheDocument();
  });

  it('re-ranks on a filter change without going back to the network', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({ id: 'steam:1', name: 'Console Pick', platforms: ['ps5'] }),
          game({ id: 'steam:2', name: 'Desktop Pick', platforms: ['pc'] }),
        ],
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Console Pick/i });

    await user.selectOptions(screen.getByLabelText(/platform/i), 'ps5');

    // The new ranking is simply there — no loading state in between (R32) and
    // no second fetch, because ranking is a pure function over what is loaded.
    expect(screen.queryByRole('heading', { name: /reading the room/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Console Pick/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desktop Pick/i })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('states honestly when a filter combination matches nothing at any timeframe', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({ games: [game({ id: 'steam:1', name: 'Desktop Pick', platforms: ['pc'] })] }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Desktop Pick/i });

    await user.selectOptions(screen.getByLabelText(/platform/i), 'ios');

    expect(screen.getByRole('heading', { name: /nothing matches those filters/i })).toBeInTheDocument();
    // Nothing was widened, because widening could not have helped. Assert the
    // relaxed-timeframe copy is absent directly: role="status" is no longer a
    // proxy for "a notice showed" now that the exhausted state and Astryx
    // buttons carry their own status roles.
    expect(screen.queryByText(/widened the timeframe/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /reset filters/i }));
    expect(screen.getByRole('button', { name: /Desktop Pick/i })).toBeInTheDocument();
  });

  it('covers AE6: a dismissed game stays out of every mode and timeframe', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            evidence: [
              evidence({ community: 'r/patientgamers', window: 'week' }),
              evidence({ community: 'r/patientgamers', window: 'year' }),
            ],
          }),
          game({
            id: 'steam:2',
            name: 'Broadcast Storm',
            // Present in every window, so the assertion after the reload is
            // about the dismissal rather than about which timeframe stuck.
            evidence: [
              evidence({ community: 'r/patientgamers', window: 'week' }),
              evidence({ community: 'r/patientgamers', window: 'month' }),
              evidence({ community: 'r/patientgamers', window: 'sixMonths' }),
              evidence({ community: 'r/patientgamers', window: 'year' }),
            ],
          }),
        ],
      }),
    );

    const { unmount } = render(<App />);
    await user.click(await screen.findByRole('button', { name: /Signal Drift/i }));
    await user.click(screen.getByRole('button', { name: /hide this game/i }));

    expect(screen.queryByRole('button', { name: /Signal Drift/i })).toBeNull();

    for (const mode of ['Top', 'Most discussed', 'Breakout', 'Rising']) {
      await user.click(screen.getByRole('button', { name: mode }));
      expect(screen.queryByRole('button', { name: /Signal Drift/i })).toBeNull();
    }
    await user.selectOptions(screen.getByLabelText(/timeframe/i), 'year');
    expect(screen.queryByRole('button', { name: /Signal Drift/i })).toBeNull();

    // And it is still gone on the next visit, against a freshly fetched corpus.
    unmount();
    render(<App />);
    await screen.findByRole('button', { name: /Broadcast Storm/i });
    expect(screen.queryByRole('button', { name: /Signal Drift/i })).toBeNull();
  });

  it('covers AE5: disabling a source drops its evidence with no re-ingest', async () => {
    const user = userEvent.setup();
    serveCorpus(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Lemmy Only',
            evidence: [
              evidence({ community: 'lemmy.world/c/games', window: 'week', source: 'lemmy' }),
            ],
          }),
          game({ id: 'steam:2', name: 'Reddit Only' }),
        ],
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Lemmy Only/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    const sources = within(screen.getByRole('region', { name: 'Sources' }));
    await user.click(sources.getByRole('checkbox', { name: /Lemmy/i }));
    await user.click(screen.getByRole('button', { name: /done/i }));

    expect(screen.queryByRole('button', { name: /Lemmy Only/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Reddit Only/i })).toBeInTheDocument();
    // No refetch: the corpus in hand already carries which source said what.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a community the reader added across reloads', async () => {
    const user = userEvent.setup();
    serveCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    const { unmount } = render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(screen.getByText('r/emulation')).toBeInTheDocument();

    unmount();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /settings/i }));
    expect(screen.getByText('r/emulation')).toBeInTheDocument();
  });

  it('lets a community the reader adds change the ranking before the next run', async () => {
    const user = userEvent.setup();
    const body = serializeCorpus(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Stardew Valley',
            ownerBand: { min: 500_000, max: 1_000_000 },
            reviewCount: 20_000,
          }),
        ],
      }),
    );
    // The corpus and the on-demand path are different endpoints, so the stub
    // has to be one too — otherwise the test proves nothing about the merge.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/adhoc')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  source: 'reddit',
                  community: 'r/emulation',
                  thread: {
                    id: 't3_adhoc',
                    title: 'Cosiest games this year',
                    permalink: 'https://reddit.test/comments/adhoc/',
                  },
                  window: 'week',
                  rankPosition: 0,
                  postedAt: '2026-07-27T09:00:00.000Z',
                  kind: 'post',
                  parentThreadId: null,
                  text: 'Stardew Valley, every time.',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(body, { status: 200 });
      }),
    );

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Stardew Valley/i }));
    expect(screen.getByRole('button', { name: /Stardew Valley/i })).toHaveTextContent(
      /1 thread across 1 community/i,
    );

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/1 mention added/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.getByRole('button', { name: /Stardew Valley/i })).toHaveTextContent(
      /2 threads across 2 communities/i,
    );
  });

  it('says so plainly when the on-demand path cannot be reached', async () => {
    const user = userEvent.setup();
    const body = serializeCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/adhoc')) throw new TypeError('no function deployed');
        return new Response(body, { status: 200 });
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    // The community is still added — it just waits for the scheduled run.
    expect(await screen.findByText(/could not reach it/i)).toBeInTheDocument();
    expect(screen.getByText('r/emulation')).toBeInTheDocument();
  });

  it('tells a throttled reader to wait a minute, not for tomorrow', async () => {
    // The Worker meters /adhoc per address, and adding a community costs one
    // request per ranking window — so a reader with a lot of them can reach the
    // ceiling on one load. Reporting that as unreachable would blame the source
    // and point at a scheduled run, when the honest answer is much shorter.
    const user = userEvent.setup();
    const body = serializeCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/adhoc')) {
          return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
        }
        return new Response(body, { status: 200 });
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/try again in a minute/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not reach it/i)).not.toBeInTheDocument();
  });

  it('lets a failed pull be tried again rather than failing it for the session', async () => {
    // The pull key is claimed before the fetch so two loads cannot pull the
    // same community twice. Holding it after a failure made that failure
    // permanent — and every failure reachable here is transient.
    const user = userEvent.setup();
    const body = serializeCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));
    let refuse = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/adhoc')) {
          if (refuse) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(body, { status: 200 });
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByText(/try again in a minute/i)).toBeInTheDocument();

    // The ceiling clears, and removing and re-adding is the reader's retry.
    refuse = false;
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    await user.type(screen.getByLabelText(/add a community/i), 'r/emulation');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/nothing it discussed is in this corpus yet/i)).toBeInTheDocument();
  });

  it('brings a dismissed game back when the reader undoes it', async () => {
    const user = userEvent.setup();
    serveCorpus(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Signal Drift/i }));
    await user.click(screen.getByRole('button', { name: /hide this game/i }));

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.click(screen.getByRole('button', { name: /bring back/i }));
    await user.click(screen.getByRole('button', { name: /done/i }));

    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });

  it('says it is showing a cached ranking when the network is unreachable', async () => {
    const cached = corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] });
    localStorage.setItem('grs:corpus:v1', serializeCorpus(cached));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );

    render(<App />);

    expect(await screen.findByText(/showing the last ranking you loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Signal Drift/i })).toBeInTheDocument();
  });
});
