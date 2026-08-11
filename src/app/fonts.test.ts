import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards R5: Stone's typefaces are self-hosted and precached with the shell, so
 * nothing at runtime reaches a third-party font host.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));

describe('self-hosted fonts (R5)', () => {
  it('precaches woff2 with the rest of the shell', () => {
    const config = readFileSync(`${root}vite.config.ts`, 'utf8');
    expect(config).toMatch(/globPatterns:\s*\[[^\]]*woff2/);
  });

  it('loads every face from a bundled @fontsource package, never a font CDN', () => {
    const fonts = readFileSync(`${root}src/app/fonts.ts`, 'utf8');
    const imports = [...fonts.matchAll(/import\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!);

    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('@fontsource/')).toBe(true);
    }
    // Nothing points at a font host: self-hosting is the whole point of R5.
    expect(fonts).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\//);
  });
});
