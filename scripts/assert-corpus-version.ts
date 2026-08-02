/**
 * Refuses a corpus the checked-out code cannot read.
 *
 *   tsx scripts/assert-corpus-version.ts public/corpus.json
 *
 * A thin CLI over `assertCorpusVersion`; the rule and its reasoning live in
 * `src/corpus/schema.ts`, alongside the SCHEMA_VERSION it compares against.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertCorpusVersion } from '../src/corpus/schema.js';

function main(argv: string[]): void {
  const path = argv[0];
  if (!path) {
    console.error('usage: assert-corpus-version <corpus-path>');
    process.exit(2);
  }

  try {
    console.log(`Corpus schemaVersion ${assertCorpusVersion(readFileSync(resolve(path), 'utf8'))} matches this tree.`);
  } catch (error) {
    console.error(`::error::${(error as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('assert-corpus-version.ts')) {
  main(process.argv.slice(2));
}
