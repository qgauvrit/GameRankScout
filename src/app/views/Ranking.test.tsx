// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ranking } from './Ranking.js';
import { rankGames } from '../../ranking/score.js';
import { evidence, game } from '../../../test/factory.js';
import type { RankedGame } from '../../ranking/score.js';
import type { GameEntry } from '../../corpus/schema.js';

function rank(games: GameEntry[]) {
  return rankGames(games, {
    mode: 'hiddenGems',
    window: 'week',
    now: Date.parse('2026-07-28T00:00:00.000Z'),
  });
}

function renderRanking(ranked: RankedGame[], onDismiss = vi.fn()) {
  const result = render(<Ranking ranked={ranked} onDismiss={onDismiss} />);
  return { ...result, onDismiss };
}

function entryFor(name: string) {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

/** A ranked list of `count` distinct games, for exercising the paged reveal. */
function manyRanked(count: number, idPrefix = 'steam') {
  return rank(
    Array.from({ length: count }, (_, index) =>
      game({ id: `${idPrefix}:${index + 1}`, name: `Game ${index + 1}` }),
    ),
  );
}

describe('ranking view', () => {
  it('renders every ranked game in order, with its position', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        ownerBand: { min: 20_000, max: 50_000 },
      }),
      game({
        id: 'steam:2',
        name: 'Broadcast Storm',
        ownerBand: { min: 5_000_000, max: 10_000_000 },
      }),
    ]);

    renderRanking(ranked);

    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    // Obscurity is the default lens, so the less-owned game leads (D4).
    expect(entries[0]!).toHaveTextContent('Signal Drift');
    expect(entries[0]!).toHaveTextContent('1');
    expect(entries[1]!).toHaveTextContent('Broadcast Storm');
  });

  it('exposes a game’s contributing threads in one interaction', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({
            community: 'r/patientgamers',
            window: 'week',
            thread: {
              id: 't3_aaa',
              title: 'What did you play this week?',
              permalink: 'https://reddit.test/comments/aaa/',
            },
          }),
        ],
      }),
    ]);

    renderRanking(ranked);

    // Nothing before the interaction...
    expect(screen.queryByRole('link', { name: /What did you play this week/i })).toBeNull();

    await user.click(entryFor('Signal Drift'));

    // ...and the discussion is reachable after exactly one.
    const thread = screen.getByRole('link', { name: /What did you play this week/i });
    expect(thread).toHaveAttribute('href', 'https://reddit.test/comments/aaa/');
  });

  it('opens thread links in a new context without leaking the referrer', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const thread = screen.getByRole('link', { name: /Thread/i });
    expect(thread).toHaveAttribute('target', '_blank');
    expect(thread.getAttribute('rel')).toContain('noreferrer');
  });

  it('names the community each thread came from', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week' }),
          evidence({ community: 'lemmy.world/c/games', window: 'week', source: 'lemmy' }),
        ],
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const detail = screen.getByRole('region', { name: /Signal Drift/i });
    expect(detail).toHaveTextContent('r/patientgamers');
    expect(detail).toHaveTextContent('lemmy.world/c/games');
  });

  it('lists a thread once even when it appears in several windows', async () => {
    const user = userEvent.setup();
    const thread = {
      id: 't3_big',
      title: 'The one everyone read',
      permalink: 'https://reddit.test/comments/big/',
    };
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week', thread }),
          evidence({ community: 'r/patientgamers', window: 'year', thread }),
        ],
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    expect(screen.getAllByRole('link', { name: /The one everyone read/i })).toHaveLength(1);
  });

  it('links out to the store page (R12)', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        storeLinks: [{ store: 'steam', url: 'https://store.steampowered.com/app/9/' }],
      }),
    ]);

    renderRanking(ranked);

    expect(screen.getByRole('link', { name: /Steam/i })).toHaveAttribute(
      'href',
      'https://store.steampowered.com/app/9/',
    );
  });

  it('renders a game whose metadata lookup failed with the fields that resolved', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        storeLinks: [],
        tags: [],
        genres: [],
        ownerBand: null,
        reviewCount: null,
        handheld: null,
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    // The name and the evidence are what actually resolved, and both still show.
    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.getByRole('heading', { name: 'Signal Drift' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Thread/i })).toBeTruthy();
    // A missing store link is stated rather than silently absent.
    expect(screen.getByRole('region', { name: /Signal Drift/i })).toHaveTextContent(
      /no store link/i,
    );
  });

  it('opens the evidence in a sheet and closes it again (R9)', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    renderRanking(ranked);

    expect(screen.queryByRole('region', { name: /Signal Drift/i })).toBeNull();
    await user.click(entryFor('Signal Drift'));
    expect(screen.getByRole('region', { name: /Signal Drift/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('region', { name: /Signal Drift/i })).toBeNull();
  });

  it('summarises the evidence behind an entry before it is opened', () => {
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        evidence: [
          evidence({ community: 'r/patientgamers', window: 'week' }),
          evidence({ community: 'r/gamingsuggestions', window: 'week' }),
        ],
      }),
    ]);

    renderRanking(ranked);

    // The summary is on the row, visible before the sheet is opened.
    expect(screen.getByText(/2 threads across 2 communities/i)).toBeInTheDocument();
  });

  it('reads out a stronger row for more cross-window evidence (R10)', () => {
    const strongThread = {
      id: 't_strong',
      title: 'Discussed everywhere',
      permalink: 'https://reddit.test/comments/strong/',
    };
    const weakThread = {
      id: 't_weak',
      title: 'Discussed once',
      permalink: 'https://reddit.test/comments/weak/',
    };
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Strong Signal',
        evidence: [
          evidence({ community: 'r/a', window: 'week', thread: strongThread }),
          evidence({ community: 'r/a', window: 'month', thread: strongThread }),
          evidence({ community: 'r/a', window: 'year', thread: strongThread }),
        ],
      }),
      game({
        id: 'steam:2',
        name: 'Weak Signal',
        evidence: [evidence({ community: 'r/a', window: 'week', thread: weakThread })],
      }),
    ]);

    renderRanking(ranked);

    const strong = screen.getByRole('progressbar', { name: /Strong Signal/i });
    const weak = screen.getByRole('progressbar', { name: /Weak Signal/i });
    expect(Number(strong.getAttribute('aria-valuenow'))).toBeGreaterThan(
      Number(weak.getAttribute('aria-valuenow')),
    );
  });

  it('shows each row’s evidence strength as a visible percentage (R5)', () => {
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);
    renderRanking(ranked);

    // The number the reader sees matches the meter, without needing hover.
    const bar = screen.getByRole('progressbar', { name: /Signal Drift/i });
    const percent = Number(bar.getAttribute('aria-valuenow'));
    expect(screen.getByText(`${percent}% evidence`)).toBeInTheDocument();
  });

  it('offers to dismiss a game from its own evidence panel', async () => {
    const user = userEvent.setup();
    const ranked = rank([game({ id: 'steam:1', name: 'Signal Drift' })]);

    const { onDismiss } = renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));
    await user.click(screen.getByRole('button', { name: /hide this game/i }));

    expect(onDismiss).toHaveBeenCalledWith('steam:1');
  });

  it('renders a designed empty state rather than an empty list', () => {
    renderRanking([]);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('heading', { name: /nothing ranked/i })).toBeTruthy();
  });

  it('keeps entries independent, so opening one does not open another', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({ id: 'steam:1', name: 'Signal Drift', ownerBand: { min: 20_000, max: 50_000 } }),
      game({ id: 'steam:2', name: 'Broadcast Storm' }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    expect(screen.getByRole('region', { name: /Signal Drift/i })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Broadcast Storm/i })).toBeNull();
  });

  // Paging behavior (initial page bound, auto-append on scroll, reset on a new
  // ranked set, single-page case) is exercised against the IntersectionObserver
  // in the 'Ranking windowing' block below, since the reveal is now on-scroll
  // rather than a button.

  it('shows the metadata filtering is built on', async () => {
    const user = userEvent.setup();
    const ranked = rank([
      game({
        id: 'steam:1',
        name: 'Signal Drift',
        platforms: ['pc', 'switch'],
        tags: ['Roguelike', 'Cozy'],
        ownerBand: { min: 200_000, max: 500_000 },
        handheld: { deck: 'verified', protonTier: 'platinum' },
      }),
    ]);

    renderRanking(ranked);
    await user.click(entryFor('Signal Drift'));

    const detail = within(screen.getByRole('region', { name: /Signal Drift/i }));
    expect(detail.getByText(/Roguelike/)).toBeTruthy();
    expect(detail.getByText(/PC/)).toBeTruthy();
    expect(detail.getByText(/Switch/)).toBeTruthy();
    expect(detail.getByText(/200K/)).toBeTruthy();
    expect(detail.getByText(/Deck Verified/i)).toBeTruthy();
  });
});

/**
 * The ranking renders in batches of 25 and auto-extends as a sentinel below the
 * list scrolls into view. jsdom implements no `IntersectionObserver` (and a
 * headless/hidden tab freezes the real one), so the observer is stubbed here:
 * the test captures each instance's callback and fires it to stand in for the
 * sentinel entering the viewport. This exercises the windowing logic directly
 * rather than relying on layout the test environment cannot produce.
 */

interface StubObserver {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
}

let observers: StubObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  private record: StubObserver;

  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, observed: [], disconnected: false };
    observers.push(this.record);
  }

  observe(target: Element): void {
    this.record.observed.push(target);
  }
  disconnect(): void {
    this.record.disconnected = true;
  }
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Fire the most recently created, still-connected observer as if intersecting. */
function scrollSentinelIntoView() {
  const live = [...observers].reverse().find((o) => !o.disconnected && o.observed.length > 0);
  if (!live) throw new Error('no live observer to trigger');
  act(() => {
    live.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function rowCount(): number {
  return screen.getAllByRole('listitem').length;
}

describe('Ranking windowing', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders only the first batch of 25 for a longer ranking', () => {
    render(<Ranking ranked={manyRanked(60)} onDismiss={() => {}} />);
    expect(rowCount()).toBe(25);
  });

  it('appends the next batch each time the sentinel scrolls into view', () => {
    render(<Ranking ranked={manyRanked(60)} onDismiss={() => {}} />);
    expect(rowCount()).toBe(25);

    scrollSentinelIntoView();
    expect(rowCount()).toBe(50);

    scrollSentinelIntoView();
    expect(rowCount()).toBe(60); // clamped to the total, not 75
  });

  it('renders everything at once when the ranking fits in one batch', () => {
    render(<Ranking ranked={manyRanked(10)} onDismiss={() => {}} />);
    expect(rowCount()).toBe(10);
    // Nothing more to load, so no sentinel is observed.
    expect(observers.some((o) => o.observed.length > 0)).toBe(false);
  });

  it('resets to the first batch when the ranked set changes (new filter/mode)', () => {
    const view = render(<Ranking ranked={manyRanked(60)} onDismiss={() => {}} />);
    scrollSentinelIntoView();
    expect(rowCount()).toBe(50);

    // A new filter/mode/window yields a fresh ranked array.
    view.rerender(<Ranking ranked={manyRanked(60, 'other')} onDismiss={() => {}} />);
    expect(rowCount()).toBe(25);
  });

  it('keeps the expanded list intact when a detail sheet opens', async () => {
    const user = userEvent.setup();
    render(<Ranking ranked={manyRanked(26)} onDismiss={() => {}} />);
    scrollSentinelIntoView(); // reveal all 26
    expect(rowCount()).toBe(26);

    // Opening an entry must not collapse the list back to the first page —
    // the sheet does not change `ranked`, so the reveal is preserved.
    await user.click(entryFor('Game 26'));
    expect(screen.getByRole('region', { name: /Game 26/i })).toBeInTheDocument();
    expect(rowCount()).toBe(26);
  });
});
