import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards R36: no reachable route renders unstyled chrome.
 *
 * Reading the stylesheet against the components catches the thing a rendering
 * test cannot — a class that exists in the markup, renders as bare text, and
 * looks broken only to whoever happens to reach that state. It is checked
 * statically because the alternative is visiting every state in a browser and
 * trusting someone to notice.
 */

const APP_DIR = new URL('.', import.meta.url).pathname;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')
      ? [path]
      : [];
  });
}

function collect(text: string, into: Set<string>): void {
  for (const token of text.split(/\s+/)) {
    if (/^[a-z][a-z0-9-]*$/.test(token)) into.add(token);
  }
}

/**
 * Every class name a component can put on an element, static or interpolated.
 *
 * A template literal contributes its static text plus any string literal inside
 * its expressions — `` `mode${active ? ' active' : ''}` `` yields `mode` and
 * `active`. The expression's own identifiers are deliberately skipped: they are
 * variable names, not class names.
 */
function classesUsed(source: string): Set<string> {
  const found = new Set<string>();
  const attribute = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

  for (const match of source.matchAll(attribute)) {
    if (match[1] !== undefined) {
      collect(match[1], found);
      continue;
    }
    const template = match[2] ?? '';
    collect(template.replace(/\$\{[^}]*\}/g, ' '), found);
    for (const expression of template.matchAll(/\$\{([^}]*)\}/g)) {
      for (const literal of expression[1]!.matchAll(/'([^']*)'|"([^"]*)"/g)) {
        collect(literal[1] ?? literal[2] ?? '', found);
      }
    }
  }
  return found;
}

function classesStyled(css: string): Set<string> {
  const found = new Set<string>();
  for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(match[1]!);
  return found;
}

describe('styling coverage', () => {
  it('gives every class the components render a rule in the stylesheet', () => {
    const css = classesStyled(readFileSync(join(APP_DIR, 'styles.css'), 'utf8'));

    const orphans = tsxFiles(APP_DIR).flatMap((file) => {
      const used = classesUsed(readFileSync(file, 'utf8'));
      return [...used].filter((name) => !css.has(name)).map((name) => `${file}: .${name}`);
    });

    expect(orphans).toEqual([]);
  });

  it('finds the components it is meant to be checking', () => {
    // A regex that silently matched nothing would make the check above vacuous.
    // Counted across all components rather than App.tsx alone: as the Astryx
    // migration moves styling into the design system, any single file's bespoke
    // class count shrinks toward zero, but the suite still uses plenty until
    // U9 replaces this whole guard.
    const files = tsxFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(4);
    const totalClassesUsed = files.reduce(
      (total, file) => total + classesUsed(readFileSync(file, 'utf8')).size,
      0,
    );
    expect(totalClassesUsed).toBeGreaterThan(4);
  });
});
