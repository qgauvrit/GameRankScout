---
title: "fix: ranking scale, touch targets and settings clarity"
date: 2026-08-19
type: fix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
depth: deep
---

# fix: ranking scale, touch targets and settings clarity

## Summary

This plan addresses five findings from the live UX audit:

- undersized mobile touch targets;
- an unbounded default ranking list;
- an unhelpful failed Steam hero treatment;
- a settings screen that exposes too much catalogue detail at once; and
- evidence-strength meters that rely on an easy-to-miss visual cue.

The first-run proposition finding is explicitly excluded. No new onboarding, introductory copy or mode-explanation changes are part of this work.

The work stays within the client app. It does not alter the corpus, ranking algorithm, ingest, reader-state schema or Worker contract.

## Requirements

- **R1**: Every touch-first action on the ranking, filter, settings and detail surfaces has a 44 by 44 CSS-pixel target or a 44-pixel hit area, with visible keyboard focus retained.
- **R2**: The default ranking initially renders a bounded, useful set of results and lets the reader reveal further results deliberately without resetting their filters, mode, scroll position or rank numbering.
- **R3**: A Steam-header failure does not leave an empty visual block. The detail sheet keeps a purposeful, stable presentation whether the image loads or not.
- **R4**: Community settings foreground the reader's current selections and collapse optional catalogue content until it is needed. Existing toggles, added communities, coverage notes and on-demand status remain available.
- **R5**: Each ranking row communicates its evidence strength in text as well as through the progress indicator. The existing accessible progressbar remains intact.
- **R6**: The implementation remains CSP-clean and offline-testable. No source adapter, corpus data, score or network-dependent test changes are introduced.

## Key decisions

### KTD1: Reveal rankings in client-side pages of 25

`applyRanking` continues to calculate the complete ordered result locally. `Ranking` initially displays 25 entries and adds the next 25 when the reader chooses `Show 25 more`. This preserves the current no-round-trip filtering model and makes the ranked list substantially easier to scan on a phone.

The reveal count resets when the effective ranked-result set changes, including mode, filter, source, community and dismissal changes. It does not reset during an ordinary detail-sheet open or close. List ordinals always use the entry's original ranking position.

Do not introduce route pagination, cursor state or a corpus endpoint. The corpus is already loaded and filtering is intentionally local.

### KTD2: Use local hit-area styling instead of changing the global design-system density

The existing Astryx controls render compactly. This task must enlarge only touch-first controls in GRS, avoiding a global theme override that would alter every component and introduce regression risk.

Create local StyleX hit-area rules and small, named wrappers where necessary. Retain text size and visual density where possible, but give controls a 44-pixel minimum block size and enough inline padding. Apply the same principle to standalone external links by making their interactive area 44 pixels high without visually turning every thread title into a button.

The ranking card remains the main detail target. Steam remains a distinct external action and must retain its own usable hit area.

### KTD3: Replace a failed hero frame with a compact labelled fallback

The current `Hero` component keeps the image frame after `onError`, but its low-contrast fill reads as a blank void. On image failure, replace the image with a compact themed fallback that identifies it as unavailable, rather than reserving the full 460:215 frame.

The successful image retains its current fixed aspect ratio and privacy properties. A missing or invalid Steam link still renders no hero. The fallback must not make a fresh network request and must remain decorative to assistive technology, because the detail region and game heading already identify the game.

### KTD4: Progressive disclosure for communities

Keep the curated community set expanded because it is on by default and directly affects the ranking. Put the recommended catalogue behind a single expandable control labelled with its enabled count, for example `Recommended communities (2 selected)`. Keep reader-added communities and the add-community form outside that collapsed region so a reader can manage their own choices immediately.

Use the existing `covers`, `label`, source and coverage data. Do not change community tiers, ids or default state. A search control is deferred: the existing optional catalogue is small enough once hidden by default, while a search interaction would add more state and accessibility work than this finding requires.

### KTD5: Evidence strength gets a visible percentage

Keep the current progressbar and its descriptive hover/focus explanation. Add a visible percentage adjacent to the meter, with a short visible label only where the layout permits it. The mobile presentation must still preserve the game name, evidence summary and Steam action without horizontal overflow.

The number remains relative to the strongest entry in the current ranking, as it is today. It is not an absolute confidence score and must not be presented as one.

## Implementation units

Suggested order: **U1 -> U2 -> U3 -> U4 -> U5**. U1 establishes the local interaction styling used by later units. U2 and U5 touch the same ranking view and should land together if practical.

### U1. Establish accessible hit areas

- **Goal:** Bring every audited touch-first control to a 44-pixel target while retaining the compact Stone visual language and visible focus ring.
- **Files:** `src/app/App.tsx`, `src/app/filters/FilterBar.tsx`, `src/app/filters/FiltersSheet.tsx`, `src/app/views/EvidenceSheet.tsx`, `src/app/views/ExternalLink.tsx`, and relevant tests.
- **Approach:**
  1. Add named StyleX rules for local touch targets, rather than applying a global component override.
  2. Apply them to Settings, the five mode controls, the mode-information control, Filters, the filter-sheet selects and Done action, the detail-sheet Close action, and standalone external links.
  3. Ensure native selects continue to open the operating system picker and are associated with their visible labels.
  4. Keep the current `:focus-visible` treatment. Do not replace accessible names with icon-only labels.
- **Test scenarios:** Existing button names, pressed state, select labels, dialog control labels and external-link accessible names remain unchanged. Add focused control assertions where the design-system render exposes the focusable element.
- **Browser verification:** At 390px width, measure all audited visible controls. Each target is at least 44px in both dimensions or has a documented 44px interactive wrapper. Confirm focus remains visibly orange and there is no horizontal overflow.

### U2. Bound the ranking list and reveal more on demand

- **Goal:** Stop the default view from rendering hundreds of rows in one continuous feed.
- **Files:** `src/app/views/Ranking.tsx`, `src/app/views/Ranking.test.tsx`.
- **Approach:**
  1. Add a `PAGE_SIZE` constant of 25 and local `visibleCount` state in `Ranking`.
  2. Render `ranked.slice(0, visibleCount)`, retaining original rank positions by mapping with the entry index before slicing or by passing the original index through.
  3. Render `Show 25 more` when more entries exist. For the final page, use the remaining count, for example `Show 12 more`.
  4. Reset `visibleCount` to 25 when the ranked input changes. Keep the detail state independent, so opening and closing an entry never reduces the revealed list.
  5. Add a concise result count near the reveal control, for example `25 of 437 games shown`, so the bounded list does not imply the ranking ends there.
- **Test scenarios:**
  - 26 entries render 25 plus `Show 1 more`; activating it renders all 26 in correct ordinal order.
  - A list of 50 renders two equal pages.
  - A list of 25 or fewer has no reveal control.
  - Replacing `ranked` resets the visible set to the first page.
  - Opening a detail sheet after revealing more does not collapse the list.
- **Browser verification:** Confirm the initial phone page is materially shorter, the reveal control is reachable after the list, and loading more does not jump the reader back to the page top.

### U3. Make hero-image failure intentional

- **Goal:** Remove the empty dark region shown when the Steam header cannot load.
- **Files:** `src/app/views/GameDetail.tsx`, `src/app/views/GameDetail.test.tsx`.
- **Approach:**
  1. Split the current success and failure presentations in `Hero`.
  2. On successful load, preserve the current image frame, `alt`, `referrerPolicy` and `fetchPriority` values.
  3. On error, replace the large frame with a compact, themed, decorative fallback. It should be visually distinct from the sheet background but not compete with the game title or evidence.
  4. Preserve the no-hero path for an invalid or missing Steam URL.
- **Test scenarios:**
  - Valid Steam links render an image with decorative alternative text and the no-referrer policy.
  - Triggering `error` replaces the image with the fallback and removes the large aspect-ratio frame.
  - A game without a valid Steam link renders neither image nor fallback.
- **Browser verification:** Open a live game detail and confirm a successful hero fills the frame. Force an image failure through the existing test path and confirm the sheet begins with content rather than a blank block.

### U4. Reduce settings density through progressive disclosure

- **Goal:** Make it faster to understand and manage current community choices.
- **Files:** `src/app/settings/Communities.tsx`, `src/app/settings/Communities.test.tsx`, and, if needed, `src/app/settings/Settings.tsx`.
- **Approach:**
  1. Keep `On by default` expanded with the existing per-community controls and coverage notes.
  2. Render recommended communities within an expandable region that is closed initially when none are enabled, and open initially when one or more are enabled so existing choices remain visible.
  3. Include the enabled count in the trigger label. The control must use a real button with `aria-expanded` and a 44-pixel target.
  4. Keep `Yours`, add-community input, validation errors, loading notes and remove actions outside the recommended region.
  5. Preserve all toggle semantics and the immediate local effect of a selection.
- **Test scenarios:**
  - Recommended communities are hidden on a fresh reader state and appear after expanding the section.
  - Enabled recommendations cause the section to start expanded and accurately state the selected count.
  - Toggling a recommended community still emits the same reader-state update.
  - Added communities and the Add action remain visible regardless of the recommended region's state.
  - Existing coverage and on-demand status copy survives unchanged.
- **Browser verification:** At mobile width, confirm settings opens with a compact overview, existing selections remain discoverable, and the optional catalogue can be reached and operated with keyboard and touch.

### U5. Make evidence strength legible without hover

- **Goal:** Let readers interpret the meter at a glance on touch devices.
- **Files:** `src/app/views/Ranking.tsx`, `src/app/views/Ranking.test.tsx`.
- **Approach:**
  1. Keep `strengthPercent` as the sole calculation and continue to clamp its result.
  2. Add a visible numeric percentage beside the `ProgressBar`, paired with a concise visible label where space allows.
  3. Preserve the hover/focus explanation for the relative-ranking definition and the progressbar's existing accessible name.
  4. Adjust the right-side row layout so long game names and the Steam action still wrap cleanly at 390px.
- **Test scenarios:**
  - Strong and weak fixtures show their corresponding visible percentages.
  - The progressbar values and accessible labels stay unchanged.
  - A narrow layout retains each game name, percentage and store action without clipping or horizontal scroll.
- **Browser verification:** Check desktop and 390px views. The meter should be understandable without hover, and no row should become taller than necessary or lose its Steam action.

## Verification

Run `npm run lint` and `npm test`. Keep the test suite network-free.

Perform a live browser walkthrough at desktop width and 390px mobile width:

1. Tab through header, mode, filter, detail and external-link actions. Confirm focus and target size.
2. Load multiple ranking pages, open an entry and close it. Confirm list state and ordinals remain stable.
3. Check hero success and the controlled image-error fallback.
4. Open settings, expand and collapse recommendations, toggle an entry, add an invalid community and verify the existing error treatment.
5. Inspect console output for new warnings or CSP violations.

## Deferred

- First-run proposition and mode-explanation changes, by explicit scope decision.
- Search or category filters within recommended communities.
- Any changes to score calculation, source coverage, corpus volume, ingestion or publication.
