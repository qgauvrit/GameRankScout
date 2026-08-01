# GameRankScout

Ranks games by what communities are actually discussing, and surfaces the ones you have not heard of.

A static React SPA (Vite, PWA) reading a corpus built by a scheduled ingest that sweeps Reddit, Lemmy, itch and Steam. A small Cloudflare Worker (`worker/adhoc.ts`) fetches a reader-added community on demand, because none of the sources send CORS headers.

## Orientation

- `CONCEPTS.md` — shared domain vocabulary (Corpus, Evidence Record, Source Item, Mention, Window, Community, Fixture). Worth reading before touching `src/corpus`, `src/extract`, or `src/ingest`; these words have precise local meanings.
- `docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organised by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.
- `docs/plans/` — the requirements and design record. Requirements are `R<n>`, key decisions are `KTD<n>`, and code comments cite them by id.

## Invariants

These are load-bearing and easy to break by accident.

- **The corpus is never committed** (KTD11). It is a deployment artifact built by the ingest and gitignored at every path it can land in. The ingest workflow fails the run if a corpus reaches the working tree.
- **Fixtures carry no author identity.** `test/fixtures/` holds recordings of real source payloads in a public repository; author names are stripped on capture and `test/fixtures.test.ts` enforces it across every committed fixture. A leak already in history is a history problem, not a tip problem — see `docs/solutions/security-issues/`.
- **Post and comment bodies never reach the corpus.** A `SourceItem`'s text is transient: extraction reads it and it is discarded before publication. What persists is references — identifiers, community names, titles, permalinks.
- **Tests run without network.** Adapters and scoring run against recorded fixtures; the extraction precision gate reads a committed catalogue (KTD8).

## Commands

```
npm run dev        # Vite dev server
npm test           # vitest run — no network
npm run lint       # tsc --noEmit && eslint
npm run ingest     # full sweep; slow by design (paced to source rate limits)
npm run ingest:dry # writes to data/dry-run, never replaces the published corpus
```
