# Ranking auto-loads the next batch on scroll instead of rendering all at once

Written against: b03b0f0a3c51b4cc06e786015c17fee3b8a08934

> **Scope note — this is a feature plan, not a design finding.** The improve-ui
> skill that produced the other plans in this directory is read-only on product
> source and audits visual presentation only; changing whether the list
> incrementally loads is a *behavior* change, which that audit deliberately
> excludes. This plan is written because the change was requested directly. It
> still touches only the view layer (`src/app/views/Ranking.tsx`) — corpus,
> ranking, and filtering are untouched — and is fully within another agent's
> reach to execute.

## Current behavior

There is **no pagination and no "load more" button today.** `src/app/views/Ranking.tsx`
maps the entire `ranked` array into one `<ol>` in a single render. Filtering and
ranking are pure functions over the loaded corpus (`applyRanking` in
`src/app/filters/apply.ts`), so `App` hands `Ranking` the full ordered result and
a filter/mode/window change produces a new `ranked` array with no fetch (R12).

## Desired behavior

Render the ranking in batches of 25. Show the first 25 rows; when the reader
scrolls near the bottom, automatically append the next 25, and so on until the
whole `ranked` list is shown — no button, no fetch (everything is already in
memory). Changing filter/mode/window resets the view to the first 25 (the reader
is looking at a fresh ranking and should start at the top).

## Design decision

Add view-local windowing to `Ranking` only. Keep `App` passing the full
`result.ranked`; `Ranking` renders a `ranked.slice(0, visibleCount)` and grows
`visibleCount` by 25 when a sentinel element after the list scrolls into view,
detected with an `IntersectionObserver`. This keeps the change isolated to the
one component, preserves the "filter change is a pure re-render, never a fetch"
contract (R12) — appending more rows is also just a render — and needs no new
dependency (`IntersectionObserver` is available in every browser the PWA targets).

`visibleCount` resets to the initial batch whenever the `ranked` identity changes
(a new filter/mode/window result), so switching lenses starts at the top rather
than deep in a previous, longer list.

## Reuse

- Existing `Ranking` structure: the `<ol {...stylex.props(styles.list)}>` and the
  `Entry` component are unchanged; only how many `Entry` rows are mapped changes.
- Existing evidence-sheet wiring: `openId`/`openEntry` already looks up against
  the full `ranked` (`ranked.find(...)`), and a row can only be opened while it is
  rendered, so windowing needs no change there.
- No new primitive; this is view-local state plus a browser API.

## Changes

1. `src/app/views/Ranking.tsx`
   - Change: Introduce a batch constant and windowing state at the top of the
     `Ranking` component:
     ```tsx
     const BATCH_SIZE = 25;
     // ...
     const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
     ```
   - Change: Reset the window when the result changes. Key the reset on a stable
     signature of the current result so it fires on filter/mode/window change but
     not on every render:
     ```tsx
     // Reset to the first batch whenever the ranked set changes (new filter/
     // mode/window). ranked is a fresh array per applyRanking result.
     useEffect(() => {
       setVisibleCount(BATCH_SIZE);
     }, [ranked]);
     ```
     (`ranked` is a new array identity per `applyRanking` result — see
     `App.tsx`'s `useMemo` over `[corpus, reader]` — so this effect fires exactly
     when the ranking is recomputed.)
   - Change: Render only the visible slice:
     ```tsx
     const visible = ranked.slice(0, visibleCount);
     const hasMore = visibleCount < ranked.length;
     ```
     Map `visible` (not `ranked`) into the `<ol>`.
   - Change: After the `<ol>`, when `hasMore`, render a sentinel `<li>` (or a
     `<div>` outside the list to keep list semantics clean — prefer a sibling
     element after the `</ol>`) and observe it:
     ```tsx
     const sentinelRef = useRef<HTMLDivElement | null>(null);
     useEffect(() => {
       const node = sentinelRef.current;
       if (!node || !hasMore) return;
       const observer = new IntersectionObserver(
         (entries) => {
           if (entries.some((e) => e.isIntersecting)) {
             setVisibleCount((c) => Math.min(c + BATCH_SIZE, ranked.length));
           }
         },
         { rootMargin: '400px 0px' }, // start loading a little before the end
       );
       observer.observe(node);
       return () => observer.disconnect();
     }, [hasMore, ranked.length]);
     ```
     Render `{hasMore && <div ref={sentinelRef} aria-hidden="true" />}` after the
     `</ol>` and before the `<EvidenceSheet .../>`.
   - Preserve: The empty-state branch (`ranked.length === 0`), the `Entry`
     component and its props, `position={index + 1}` numbering (indexes come from
     the full order — `visible` is a prefix of `ranked`, so `index + 1` stays
     correct), the `EvidenceSheet` wiring, and all existing StyleX styles.
   - Verify: On a ranking with > 25 games, only 25 rows render initially;
     scrolling to the bottom appends 25 more until all are shown; the sentinel
     disappears once `visibleCount >= ranked.length`.

## Scope

- Inherit: The ranking list rendering.
- Verify: `App.tsx` still passes the full `result.ranked`; no change needed there.
  The `filters-exhausted` and `relaxed` states in `App.tsx` are computed from the
  full result and are unaffected by view-local windowing.
- Exclude: `applyRanking`, the corpus, the evidence sheet, and settings. Do not
  introduce fetching — every row is already in memory.

## Validation

- Product: Load a ranking with many games. Confirm 25 rows initially; scroll down
  and confirm the next 25 append automatically without a button and without a
  loading flash; repeat to the end; confirm the list stops growing at the true
  total. Change a filter/mode/window and confirm the list jumps back to the first
  25 from the top.
- Interface: Mobile and desktop presets. Rankings of size 0 (empty state), ≤25
  (no sentinel, no observer), and ≫25 (multiple batches). Open a game's evidence
  sheet from a row in a later batch and confirm it still opens and dismisses.
- System: Confirm no fetch fires on scroll (network panel quiet) — windowing is
  pure rendering, preserving R12. Confirm the `IntersectionObserver` is
  disconnected on unmount and when `hasMore` becomes false (no observer leak;
  React StrictMode double-invokes effects in dev — the cleanup must make this
  idempotent, which `observer.disconnect()` does).
- Repository: `npm run lint && npm test` → green. Add/extend a `Ranking` test:
  with > 25 ranked entries, initially only `BATCH_SIZE` rows are in the document.
  (jsdom does not run `IntersectionObserver`; either stub it in the test setup or
  assert the initial-slice behavior and the reset-on-`ranked`-change behavior,
  and leave the scroll-append to the browser walkthrough above.)

## Stop conditions

- Stop if a stubbed/absent `IntersectionObserver` in the test environment breaks
  the suite; guard construction behind a `typeof IntersectionObserver !==
  'undefined'` check or add a jsdom stub in the test setup rather than removing
  the feature.
- Stop and confirm scope if the reader expects the loaded position to survive
  reopening the app or navigating to a game and back — that would require
  persisting `visibleCount`, which is out of scope here (view-local only).

## Design documentation

- After acceptance and validation: If the repo records requirements (`R<n>`),
  note the new one — "the ranking renders in batches of 25 and auto-extends on
  scroll, without fetching" — alongside R12/R32 in the relevant plan, since it
  refines how the pure-re-render ranking is presented. Destination:
  `docs/plans/` per the repo's convention, at the executor's discretion.
