// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { serializeCorpus } from '../corpus/schema.js';
import { corpus, evidence, game } from '../../test/factory.js';
import type { Corpus } from '../corpus/schema.js';

/**
 * Replaces the old styles.css coverage guard (R15, formerly R36). styles.css is
 * gone, so "no reachable route renders unstyled or placeholder chrome" now means
 * two things, checked by mounting real states rather than scanning source —
 * because only a mounted state proves what a reader actually reaches:
 *
 * 1. No route still renders a class from the retired stylesheet vocabulary — a
 *    component left on the deleted stylesheet would look broken only to whoever
 *    reached that state.
 * 2. Every route renders through the design system (Astryx/StyleX classes are
 *    present), not a bare fallback.
 *
 * The vocabulary below is the complete set of selectors styles.css defined. Keep
 * it in sync only if a class is intentionally revived; a new bespoke class is
 * exactly what this guard exists to reject.
 */
const RETIRED_CLASSES = new Set([
  'active', 'add-community', 'app', 'button', 'button-small', 'chip', 'chip-quiet', 'detail',
  'detail-actions', 'detail-facts', 'detail-heading', 'detail-stores', 'entry', 'entry-chevron',
  'entry-head', 'entry-meta', 'entry-name', 'entry-rank', 'entry-store', 'entry-text',
  'entry-toggle', 'field', 'field-check', 'field-label', 'filter-row', 'filters', 'freshness',
  'glyph', 'icon-button', 'link-button', 'masthead', 'masthead-end', 'mode', 'modes', 'muted',
  'notice', 'notice-intro', 'open', 'ranking', 'settings', 'settings-head', 'settings-section',
  'settings-subheading', 'spinning', 'state', 'switch', 'switch-list', 'switch-name',
  'switch-note', 'switch-text', 'tag', 'tags', 'thread', 'thread-link', 'thread-origin', 'threads',
]);

function serve(value: Corpus) {
  const body = serializeCorpus(value);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
}

function offline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
}

/** Retired stylesheet classes currently in the document, sorted for a stable diff. */
function retiredClassesOnScreen(): string[] {
  const found = new Set<string>();
  for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
    for (const cls of element.classList) if (RETIRED_CLASSES.has(cls)) found.add(cls);
  }
  return [...found].sort();
}

/** Whether anything on screen carries a design-system (Astryx/StyleX) class. */
function rendersThroughDesignSystem(): boolean {
  for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
    for (const cls of element.classList) {
      if (cls.startsWith('astryx') || cls.includes('__styles')) return true;
    }
  }
  return false;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('no reachable route renders retired stylesheet chrome (R15)', () => {
  it('the ranking, its evidence sheet, and the reading chrome are class-clean and themed', async () => {
    const user = userEvent.setup();
    serve(
      corpus({
        games: [
          game({
            id: 'steam:1',
            name: 'Signal Drift',
            evidence: [evidence({ community: 'r/patientgamers', window: 'week' })],
          }),
        ],
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /Signal Drift/i });
    // Open the evidence sheet so its chrome is on screen for the scan.
    await user.click(screen.getByRole('button', { name: /Signal Drift/i }));
    await screen.findByRole('region', { name: /Signal Drift/i });

    expect(retiredClassesOnScreen()).toEqual([]);
    expect(rendersThroughDesignSystem()).toBe(true);
    // Self-check: the scan actually reached a populated document, not an empty one.
    expect(document.body.querySelectorAll('*').length).toBeGreaterThan(20);
  });

  it('the settings surface is class-clean and themed', async () => {
    const user = userEvent.setup();
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /settings/i }));
    await screen.findByRole('region', { name: 'Sources' });

    expect(retiredClassesOnScreen()).toEqual([]);
    expect(rendersThroughDesignSystem()).toBe(true);
  });

  it('the load-time states — loading, empty, offline — are class-clean and themed', async () => {
    // Loading renders before the fetch resolves, so assert synchronously.
    serve(corpus({ games: [game({ id: 'steam:1', name: 'Signal Drift' })] }));
    const loading = render(<App />);
    expect(retiredClassesOnScreen()).toEqual([]);
    expect(rendersThroughDesignSystem()).toBe(true);
    loading.unmount();

    // Each sub-render must start from a clean cache, or a corpus cached by the
    // previous one would satisfy the next load instead of the state under test.
    localStorage.clear();
    serve(corpus({ games: [] }));
    const empty = render(<App />);
    await screen.findByRole('heading', { name: /no games ranked yet/i });
    expect(retiredClassesOnScreen()).toEqual([]);
    empty.unmount();

    localStorage.clear();
    offline();
    render(<App />);
    await screen.findByRole('heading', { name: /nothing cached yet/i });
    expect(retiredClassesOnScreen()).toEqual([]);
    expect(rendersThroughDesignSystem()).toBe(true);
  });
});
