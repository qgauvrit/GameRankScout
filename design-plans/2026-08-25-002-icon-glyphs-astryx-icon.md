# Icon buttons render Astryx icons, not raw Unicode glyphs

Written against: b03b0f0a3c51b4cc06e786015c17fee3b8a08934

## Evidence chain

- Surfaces:
  - `src/app/App.tsx` — the masthead "Settings" `IconButton` (line ~328), icon `<span aria-hidden="true">☰</span>`.
  - `src/app/views/EvidenceSheet.tsx` — the sheet "Close" `IconButton` (line ~35), icon `<span aria-hidden="true">✕</span>`.
- Problem: These two icon buttons pass raw Unicode characters as their icon, while the rest of the app renders icons through the Astryx `Icon` component with semantic names. A Unicode glyph renders in the system/text font, so its stroke weight, size, and optical alignment do not match the design-system icon set used elsewhere; the two approaches are visibly inconsistent and one bypasses the theme's icon registry.
- Design evidence:
  - Design-system plan requirement **R1** — "The app renders through Astryx components and theme tokens." ([docs/plans/2026-08-01-002-feat-astryx-design-system-plan.md](../docs/plans/2026-08-01-002-feat-astryx-design-system-plan.md), line 68.)
  - In-app exemplars using the design-system icon component: `src/app/filters/FilterBar.tsx` (`<Icon icon="info" />`) and `src/app/views/ExternalLink.tsx` (`<Icon icon="externalLink" size="sm" />`).
  - Astryx provides the exact semantic names needed: `IconName` union in `node_modules/@astryxdesign/core/dist/Icon/globalIconRegistry.d.ts` includes `'menu'` and `'close'` (both also present as built-in defaults in `defaultIcons.js`). `Icon` resolves a string name to the theme's registered icon (or a built-in fallback SVG).
- Owner: `src/app/App.tsx` and `src/app/views/EvidenceSheet.tsx`.
- Scope and affected surfaces: The masthead settings button and the evidence-sheet close button. These are the only two raw-glyph icons in `src/app` (grep for non-ASCII glyphs in aria-hidden spans returns exactly these two).
- Uncertainty: The theme may not register a custom `menu`/`close` icon; if so, `Icon` falls back to its built-in SVG for that name, which is still correct and design-system-owned. Executor should eyeball both icons after the change (a menu/hamburger and an ✕/close) to confirm the fallback glyphs read correctly.

## Design decision

Route both icon buttons through the Astryx `Icon` component with the semantic names `menu` and `close`, matching the two existing `<Icon>` call sites. This makes every icon in the product resolve through one themable registry with consistent stroke and sizing, and removes the last app-authored glyph rendering — satisfying R1 and the app's own internal precedent. The `IconButton` wrapper itself is already the design-system component and stays; only its `icon` content changes.

## Reuse

- `Icon` from `@astryxdesign/core`, names `menu` (masthead) and `close` (sheet close).
- Exemplars: `src/app/filters/FilterBar.tsx` (`<Icon icon="info" />`), `src/app/views/ExternalLink.tsx` (`<Icon icon="externalLink" size="sm" />`).

No new primitive is required.

## Changes

1. `src/app/App.tsx`
   - Change: Add `Icon` to the existing `@astryxdesign/core` import. In the "Settings" `IconButton`, replace `icon={<span aria-hidden="true">☰</span>}` with `icon={<Icon icon="menu" />}`.
   - Preserve: The `IconButton`'s `label="Settings"`, `variant="ghost"`, and `onClick={() => setShowSettings(true)}`. The button's accessible name comes from `label`, so the icon stays decorative — do not add an `aria-label` to the `Icon`.
   - Verify: A menu/hamburger icon renders in the masthead in the design-system style; clicking still opens Settings.
2. `src/app/views/EvidenceSheet.tsx`
   - Change: Add `Icon` to the existing `@astryxdesign/core` import. In the "Close" `IconButton`, replace `icon={<span aria-hidden="true">✕</span>}` with `icon={<Icon icon="close" />}`.
   - Preserve: The `IconButton`'s `label="Close"`, `variant="ghost"`, and `onClick={onClose}`.
   - Verify: A close/✕ icon renders top-right of the evidence sheet in the design-system style; clicking still closes the sheet.

## Scope

- Inherit: The masthead settings button and the evidence-sheet close button.
- Verify: No other `IconButton` in `src/app` uses a raw glyph (confirmed: only these two).
- Exclude: The `·` middot separators in copy (`labels`/`Communities`/`GameDetail`) — those are text, not icons, and are correct.

## Validation

- Product: Open the app — the masthead shows a menu icon; open a game's evidence sheet — the close button shows an ✕ icon; both act as before.
- Interface: Ranking view (masthead) and the open evidence sheet, on desktop and mobile presets; confirm the two icons visually match `info`/`externalLink` in weight and size.
- System: `grep -rnP '[^\x00-\x7F]' src/app --exclude=*.test.* | grep aria-hidden` → no glyph icons remain (only text separators elsewhere).
- Repository: `npm run lint && npm test` → green. If a test asserts the literal `☰`/`✕` text, re-point it to the button's accessible name ("Settings"/"Close") rather than the glyph.

## Stop conditions

- Stop if the running Astryx theme registers no icon for `menu` or `close` AND its built-in fallback is visually wrong — in that case surface it; do not reintroduce a Unicode glyph. A correct alternative is registering the app's own icon under that semantic name via `registerIcons`, but only if needed.

## Design documentation

- After acceptance and validation: None required. Conforms to existing R1.
