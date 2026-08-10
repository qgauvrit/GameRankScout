import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ACCENT_ORANGE } from './theme.js';

/**
 * The favicon carries the theme accent (R3, U3): it uses {@link ACCENT_ORANGE}
 * and none of the pre-theme teal. The PNGs are regenerated from this SVG, so
 * guarding the source is enough — a teal PNG cannot come from an orange source.
 */
describe('app icon', () => {
  const svg = readFileSync(fileURLToPath(new URL('../../public/icon.svg', import.meta.url)), 'utf8');

  it('uses the theme accent orange', () => {
    expect(svg.toLowerCase()).toContain(ACCENT_ORANGE.toLowerCase());
  });

  it('carries none of the retired teal', () => {
    expect(svg.toLowerCase()).not.toContain('#3a8f77');
    expect(svg.toLowerCase()).not.toContain('#7cf5c4');
  });
});
