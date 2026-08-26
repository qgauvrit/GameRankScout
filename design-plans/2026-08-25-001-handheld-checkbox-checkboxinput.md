# Handheld filter uses the Astryx CheckboxInput, like every other checkbox

Written against: b03b0f0a3c51b4cc06e786015c17fee3b8a08934

## Evidence chain

- Surface: `src/app/filters/FiltersSheet.tsx` — the "Filters" bottom sheet, "Handheld-ready only" control (rendered only when `filters.platform === 'pc'`).
- Problem: This checkbox is hand-rolled from a native `<label><input type="checkbox">` plus a separate `<Text>` element, while every other checkbox in the product renders through the Astryx `CheckboxInput` component. The two render differently (native box + system-font label vs. the design-system control with its own label/description typography, sizing, focus ring, and hit area).
- Design evidence:
  - Design-system plan requirement **R1** — "The app renders through Astryx components and theme tokens." ([docs/plans/2026-08-01-002-feat-astryx-design-system-plan.md](../docs/plans/2026-08-01-002-feat-astryx-design-system-plan.md), line 68.)
  - Sibling exemplars using the design-system control: `src/app/settings/Sources.tsx` (`CheckboxInput` for each source) and `src/app/settings/Communities.tsx` (`CheckboxInput` inside `Row`).
  - `CheckboxInput` API (from `node_modules/@astryxdesign/core/dist/CheckboxInput/CheckboxInput.d.ts`): props `label: string`, optional `description?: string`, checked state passed as `value` (see `Sources.tsx` usage `value={enabled.includes(source)}`), and `onChange?: (checked: boolean, e) => void`.
- Owner: `src/app/filters/FiltersSheet.tsx`.
- Scope and affected surfaces: The filters sheet only. No other surface renders this control.
- Uncertainty: None on the primitive choice. The exact checked-prop name is `value` (confirmed by the two exemplars); the executor should mirror those call sites rather than inventing a `checked` prop.

## Design decision

Replace the hand-rolled native checkbox with the Astryx `CheckboxInput` the rest of the app already uses. This removes the one remaining app-authored checkbox, so all three checkboxes in the product share one control, sizing, label typography, and focus treatment — satisfying R1 without changing what the control does. The native `<select>` elements in the same sheet are deliberately left as-is (documented exception: they open the platform's own picker for one-handed use, original-plan R14); that exception is about pickers and does not extend to a checkbox, which gains nothing from being native.

## Reuse

- `CheckboxInput` from `@astryxdesign/core` (already imported and used in `Sources.tsx` and `Communities.tsx`).
- Exemplar: `src/app/settings/Sources.tsx` — `<CheckboxInput label={...} value={...} onChange={...} />`.

No new primitive is required.

## Changes

1. `src/app/filters/FiltersSheet.tsx`
   - Change: Add `CheckboxInput` to the existing `@astryxdesign/core` import. Replace the `filters.platform === 'pc'` block — currently:
     ```tsx
     <label>
       <input
         type="checkbox"
         checked={filters.handheldOnly}
         onChange={(event) => set({ handheldOnly: event.target.checked })}
       />
       <Text type="body" as="span">
         Handheld-ready only
       </Text>
     </label>
     ```
     with:
     ```tsx
     <CheckboxInput
       label="Handheld-ready only"
       value={filters.handheldOnly}
       onChange={(checked) => set({ handheldOnly: checked })}
     />
     ```
   - Preserve: The `filters.platform === 'pc'` render guard, the `set({ handheldOnly })` state update, the label text "Handheld-ready only", and the control's position in the sheet (after the Tag select, before the "Done" button). Leave the four native `<select>` controls untouched.
   - Verify: The handheld control renders identically in shape to the source/community checkboxes; toggling it updates `filters.handheldOnly` and re-filters the ranking (handheld-only games) with no fetch.
2. `src/app/filters/FiltersSheet.tsx` (imports)
   - Change: If `Text` is no longer referenced anywhere else in the file after the swap, drop it from the import to keep the lint clean; otherwise leave it. (Check: `Text` is used only in this block today — grep before removing.)
   - Preserve: All other imports.
   - Verify: `npm run lint` reports no unused import.

## Scope

- Inherit: The filters sheet's handheld control.
- Verify: Nothing else consumes this control; the `apply.ts` filtering logic is unchanged.
- Exclude: The native `<select>` controls (deliberate R14 exception). No visual redesign of the sheet.

## Validation

- Product: Open Filters, set Platform to PC, toggle "Handheld-ready only" on — the ranking narrows to handheld-ready games; toggle off — it restores. Switch Platform away from PC — the control disappears and `handheldOnly` is cleared (existing behavior in the Platform `onChange`).
- Interface: The filters sheet on desktop and mobile presets; confirm the checkbox matches the Sources/Communities checkboxes in size, label, and focus ring.
- System: Confirm no native `<input type="checkbox">` remains in `src/app` outside test files (`grep -rn "type=\"checkbox\"" src/app | grep -v '\.test\.'` → no matches).
- Repository: `npm run lint && npm test` → green. Update `src/app/filters/FiltersSheet` tests if any assert on the native input structure.

## Stop conditions

- Stop if `CheckboxInput`'s `onChange` in this Astryx version does not deliver the new boolean (re-check the `.d.ts` and the `Sources.tsx`/`Communities.tsx` call sites — they are the source of truth).
- Stop if a test asserts the literal native-input markup; adjust the test to query by role/label instead of markup, do not revert the control.

## Design documentation

- After acceptance and validation: None required. This conforms the surface to existing R1; there is no new decision to record.
