# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Relationships

An Ingest sweeps every Community in the catalogue and collects Source Items. Extraction reads each Source Item's transient text and produces Mentions, which become Evidence Records. The Corpus is the published set of Evidence Records grouped by game — it never carries the text a Mention was read from.

## The pipeline

### Ingest
One end-to-end run that sweeps every Community, extracts Mentions, resolves and enriches the games named, and publishes a Corpus. A single source failing degrades the run rather than ending it, and the failure is recorded so a quietly dead source is visible to the reader rather than only in job logs.

### Source Item
A single post or comment as a source adapter emits it, before extraction has run. Its body text is transient — it exists only long enough for extraction to read it and is discarded before publication, so no post or comment body ever reaches the Corpus. One Source Item can name several games and so becomes several Evidence Records.

### Mention
A game named in a Source Item's text, carrying both the canonical game it resolved to and the surface form exactly as it appeared. The surface form is kept so an extraction decision can be audited after the text it came from is gone.

### Evidence Record
One game named once, in one thread, in one Community, in one Window. This is the unit the Corpus stores and the unit ranking counts. The same thread returned under two Windows is two Evidence Records, not a duplicate — cross-window presence is a signal ranking reads deliberately.

### Corpus
The published artifact the app reads: games, their Evidence Records, and enrichment, built by an Ingest and served as a deployment artifact. The Corpus stores references — game identifiers, community names, thread titles and permalinks — never reproductions of the discussions it points at, which is what makes it an index rather than a republication. It carries no history and is never committed to version control.

### Window
One of the fixed time spans a source's ranked listing is requested over. A game's standing is read per Window, and its presence across several is itself a signal rather than a repetition.

## Reading the ranking

### Ranking mode
The lens the whole ranking is read through — which signal the score leans on, such as favouring the unfamiliar over the popular, or recent movement over standing. A mode reorders every game; it does not remove any. This is what distinguishes it from a filter.

### Filter
A narrowing of the ranking to a subset of games — by platform, genre, tag, or timeframe. A filter removes games from view without changing how the remainder are ordered. When a filter leaves too little to rank, the timeframe widens rather than the reader being shown an empty list.

## Communities

### Community
One room a source exposes as a ranked listing — a subreddit or a Lemmy community. Communities are the unit of sweeping, the unit a reader switches on or off, and the unit evidence is attributed to.

### Curated community
A Community enabled from the first run with no configuration, chosen so that a cold open has coverage of general discussion, recommendation-seeking, handheld play, and every top-level genre. A reader switches one off; the default is on.

### Recommended community
A Community the reader switches on individually — the reverse default of a Curated community. A scheduled Ingest cannot see which Communities a given reader opted into, so it sweeps these too and their evidence is in the Corpus regardless; the reader's opt-in is what decides whether that evidence counts.

## Test data

### Fixture
A committed recording of a real source payload, kept so parser tests run against the shape a source actually returns rather than an invented one. A Fixture carries the structural shape the parser needs and nothing that identifies a person: author names are stripped on capture, and only a handful of entries are kept rather than a full feed. Both constraints exist because the repository is public, and because recording a verbatim feed would republish source content — the same principle that keeps reproductions out of the Corpus.

## Flagged ambiguities

- "Sweep" is a verb, not a noun: an Ingest sweeps Communities. There is no separate "sweep" entity.
