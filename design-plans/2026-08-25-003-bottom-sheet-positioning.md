# Bottom sheets span the bottom edge instead of pinning to the corner

Written against: b03b0f0a3c51b4cc06e786015c17fee3b8a08934

## Evidence chain

- Surfaces:
  - `src/app/views/EvidenceSheet.tsx` — the game evidence sheet (the "game window" that opens when a ranking row is tapped).
  - `src/app/filters/FiltersSheet.tsx` — the filters sheet (same positioning pattern, same root cause).
- Problem (user-reported, rendered evidence): The game window opens as a small box in the **bottom-left corner** rather than as a bottom sheet spanning the width of the reading column.
- Root cause: Both sheets are an Astryx `Dialog` (`variant` defaults to `standard`) given `position={{ bottom: 0, start: 0, end: 0 }}` but **no `width`**. Per the Dialog API (`node_modules/@astryxdesign/core/dist/Dialog/Dialog.d.ts`), `width` defaults to **`400`** (px) and is only ignored for `variant="fullscreen"`. A 400px-wide dialog with `inset-inline-start: 0` is pinned to the inline-start (left in LTR); the explicit width overrides `end: 0`, so it cannot stretch. Result: a 400px box in the bottom-left corner.
- Design evidence:
  - `DialogProps.width` — "@default 400 … Ignored when variant is 'fullscreen'." and `position` maps `start`/`end` to `inset-inline-*`.
  - The app's reading column is a centred `maxWidth: '46rem'` with `marginInline: 'auto'` (`src/app/App.tsx`, `styles.app`). A bottom sheet that reads as part of this app should align to that column, not a corner.
  - The two sheets are meant to be the same pattern: `EvidenceSheet.tsx` comment — "Reuses the sheet pattern from the filters (U5)."
- Owner: `src/app/views/EvidenceSheet.tsx` and `src/app/filters/FiltersSheet.tsx` (each owns its own `Dialog` props).
- Scope and affected surfaces: Both sheets. The user reported only the game window, but the filters sheet has the identical defect and must be fixed with it so the shared pattern stays coherent.
- Uncertainty: Whether the Astryx `Dialog` horizontally centres a fixed-width dialog when `start`/`end` are unset (`auto`). The API says "By default, the dialog will be centered," and unset offsets fall back to `auto`. The primary correction below does **not** rely on that (it spans edge-to-edge); the optional refinement does, and is gated on a quick render check.

## Design decision

Give each sheet a `width` so it is a real bottom sheet instead of a default-400px box. Primary, deterministic correction: set `width="100%"` and keep `position={{ bottom: 0, start: 0, end: 0 }}`, so the dialog spans the full bottom edge and is anchored to the bottom — resolving the corner bug with a one-prop change and no dependence on the Dialog's centring behavior. This matches the common bottom-sheet pattern and the one-handed, thumb-reachable intent of these sheets (original-plan R14). The visible content already sits inside the padded sheet, and on this app's narrow viewport (≤46rem column) full-width and column-width converge, so full-width reads correctly on phones, the primary target.

## Reuse

- Existing `Dialog` props already on both call sites (`isOpen`, `onOpenChange`, `position`, `maxHeight`, `padding`). Only `width` is added.
- Exemplar / cross-check: the two call sites are each other's exemplar; keep them identical in the width they adopt so the shared "sheet pattern" stays true.

No new primitive is required — the fix is a missing prop, not a new component.

## Changes

1. `src/app/views/EvidenceSheet.tsx`
   - Change: On the `Dialog`, add `width="100%"`. Keep `position={{ bottom: 0, start: 0, end: 0 }}`, `maxHeight="85vh"`, `padding={4}`.
   - Preserve: The open/close wiring (`isOpen={entry !== null}`, `onOpenChange`), the close `IconButton`, and the `GameDetail` content.
   - Verify: Opening a ranking row shows a sheet flush to the bottom edge spanning the full width, not a bottom-left box; closing works via the ✕ and Escape/backdrop.
2. `src/app/filters/FiltersSheet.tsx`
   - Change: On the `Dialog`, add `width="100%"`. Keep `position={{ bottom: 0, start: 0, end: 0 }}`, `maxHeight="80vh"`, `padding={4}`.
   - Preserve: The "Filters" trigger button, the sheet content (selects, handheld control, "Done"), and the open/close wiring.
   - Verify: Opening Filters shows a full-width bottom sheet, not a corner box.

## Scope

- Inherit: Both `Dialog`-based sheets.
- Verify: No other `Dialog` exists in `src/app` (`grep -rn "<Dialog" src/app | grep -v '\.test\.'` returns only these two, via `EvidenceSheet` and `FiltersSheet`).
- Exclude: The Dialog's dismissal/`purpose` behavior and `maxHeight` values (each sheet keeps its own). No change to `GameDetail` or filter contents.

## Validation

- Product: Tap a ranking row → the evidence sheet rises from the bottom, full width, content readable and scrollable to `maxHeight`; close it. Open Filters → same bottom-sheet behavior.
- Interface: Mobile preset (primary) and desktop preset; both sheets; verify neither pins to a corner and the backdrop covers the viewport. Check an entry with long content (many cited threads) still scrolls within `maxHeight` rather than overflowing.
- System: Both sheets share the identical `width` value, preserving the "reuses the filters sheet pattern" invariant.
- Repository: `npm run lint && npm test` → green. If a `states`/`styling` test asserts on Dialog dimensions, update it to expect the spanning sheet.

## Stop conditions

- Stop and reconsider if `width="100%"` visibly overflows or fights the Dialog's own max-width in this Astryx version; fall back to an explicit spanning width and note it.

## Optional refinement (design-preferred; not required to fix the bug)

Cap the sheet at the reading column and centre it, so on wide desktop viewports the sheet aligns to the 46rem content rather than going full-bleed: set `width="min(46rem, 100%)"` and change `position` to `{ bottom: 0 }` (drop `start`/`end` so the inline axis falls back to the Dialog's default centring). Adopt this **only after** confirming in the browser that the Dialog centres a fixed-width sheet with `start`/`end` unset; if it does not centre (pins to a corner again), keep the primary `width="100%"` correction. Apply the same choice to both sheets.

## Design documentation

- After acceptance and validation: Record the bottom-sheet contract next to the "reuses the filters sheet pattern" note — sheets are `Dialog` with `position={{ bottom: 0, ... }}` **and an explicit `width`** (state whichever was adopted: `100%`, or `min(46rem,100%)` centred), so the missing-width corner defect cannot recur. Destination: a short comment at both call sites, or a design note in `docs/` if one is added.
