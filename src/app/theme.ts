import { defineTheme } from '@astryxdesign/core/theme';
import { stoneTheme } from '@astryxdesign/theme-stone';

/**
 * The single accent colour (R3). Orange is a highlight over Stone's warm slate,
 * reserved for rank emphasis and each view's primary action — not a wash.
 */
export const ACCENT_ORANGE = '#f97316';

/**
 * GameRankScout's theme (R2, R3): Stone's warm-slate neutrals with the accent
 * family regenerated from orange.
 *
 * `extends: stoneTheme` inherits Stone's neutrals, fonts, and component
 * overrides. `color.accent` derives the whole accent ramp (hover, subtle,
 * on-accent) from one orange so the highlight stays coherent, and the explicit
 * `--color-accent` token pins the primary accent to exactly {@link ACCENT_ORANGE}.
 * The app renders dark-only; the [light, dark] tuple carries the same orange in
 * both slots so the token is stable whatever mode a consumer requests.
 */
export const grsTheme = defineTheme({
  name: 'grs',
  extends: stoneTheme,
  color: { accent: ACCENT_ORANGE },
  tokens: { '--color-accent': [ACCENT_ORANGE, ACCENT_ORANGE] },
});
