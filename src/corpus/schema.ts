import { z } from 'zod';

/**
 * Bump whenever the corpus shape changes in a way a previously-cached corpus
 * cannot satisfy. Reader state (dismissals, enabled sources, filter selections)
 * is keyed against this value per KTD10, and the app discards a cached corpus
 * carrying a superseded version rather than attempting to migrate it.
 */
export const SCHEMA_VERSION = 1;

export class CorpusVersionMismatchError extends Error {
  constructor(found: unknown, expected: number) {
    super(
      `Corpus is schemaVersion ${String(found)}, but this tree reads ${expected}. ` +
        'Run the ingest against the current default branch to publish a corpus at the new version.',
    );
    this.name = 'CorpusVersionMismatchError';
  }
}

/**
 * Checks a raw corpus against the version this tree can read, without paying
 * for full validation.
 *
 * The publish job builds current code against a corpus the sweep produced hours
 * earlier, so a `SCHEMA_VERSION` bump landing in between pairs new code with an
 * old corpus. The app would then load and report no ranking, from a deployment
 * that looks healthy from outside — so the pairing is checked before deploying,
 * where failing leaves the previous working deployment live.
 */
export function assertCorpusVersion(raw: string, expected: number = SCHEMA_VERSION): number {
  const found = (JSON.parse(raw) as { schemaVersion?: unknown }).schemaVersion;
  if (found !== expected) throw new CorpusVersionMismatchError(found, expected);
  return expected;
}

export const RANKING_WINDOWS = ['week', 'month', 'sixMonths', 'year'] as const;
export type RankingWindow = (typeof RANKING_WINDOWS)[number];

export const SOURCE_IDS = ['reddit', 'lemmy', 'itch', 'steam'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const PLATFORMS = [
  'pc',
  'switch',
  'switch2',
  'ps5',
  'xbox-series',
  'android',
  'ios',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STORES = [
  'steam',
  'itch',
  'gog',
  'epic',
  'nintendo',
  'playstation',
  'xbox',
  'app-store',
  'play-store',
  'other',
] as const;

/**
 * Steam's own compatibility verdict. `unknown` is a real state — plenty of games
 * have never been rated — and is distinct from the field being absent.
 */
export const DECK_CATEGORIES = ['verified', 'playable', 'unsupported', 'unknown'] as const;

/** ProtonDB community tiers, used as fallback when Steam has issued no verdict. */
export const PROTON_TIERS = ['platinum', 'gold', 'silver', 'bronze', 'borked', 'pending'] as const;

/**
 * `z.string().url()` accepts any parseable URL, including `javascript:`. Every
 * link in the corpus is rendered as an outbound anchor, so the scheme is
 * constrained here rather than at each render site.
 */
const httpUrl = z
  .string()
  .refine((value) => /^https?:\/\//i.test(value), { message: 'must be an http(s) URL' });

const isoTimestamp = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
  { message: 'must be an ISO 8601 timestamp' },
);

export const threadRefSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  permalink: httpUrl,
});

/**
 * Only Lemmy exposes real figures today; Reddit RSS carries no score at all, so
 * both fields stay optional and ranking treats absence as "unknown", never zero.
 */
export const engagementSchema = z.object({
  score: z.number().int().optional(),
  comments: z.number().int().nonnegative().optional(),
});

export const evidenceRecordSchema = z.object({
  source: z.enum(SOURCE_IDS),
  community: z.string().min(1),
  thread: threadRefSchema,
  window: z.enum(RANKING_WINDOWS),
  /** Zero-based position in the source's ranked listing — the portable signal per D6. */
  rankPosition: z.number().int().nonnegative(),
  postedAt: isoTimestamp,
  /** The surface form as it appeared in the text, kept for auditing extraction. */
  mention: z.string().min(1),
  /** Canonical game id, or null before identity resolution has run. */
  gameId: z.string().nullable(),
  engagement: engagementSchema.optional(),
});

/**
 * What a source adapter emits, before mention extraction has run (KTD2).
 *
 * This is deliberately *not* an {@link EvidenceRecord}: one item can mention
 * several games and so becomes several evidence records, and `text` is
 * transient — it exists only long enough for extraction to read it and is
 * discarded before publication, so no post or comment body ever reaches the
 * corpus (KTD11).
 */
export const sourceItemSchema = z.object({
  source: z.enum(SOURCE_IDS),
  community: z.string().min(1),
  thread: threadRefSchema,
  window: z.enum(RANKING_WINDOWS),
  rankPosition: z.number().int().nonnegative(),
  postedAt: isoTimestamp,
  kind: z.enum(['post', 'comment']),
  /** For a comment, the id of the post it belongs to. Null for a post. */
  parentThreadId: z.string().nullable(),
  /** Transient body text. Never serialized into a corpus. */
  text: z.string(),
  engagement: engagementSchema.optional(),
});

export type SourceItem = z.infer<typeof sourceItemSchema>;

export const ownerBandSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

export const storeLinkSchema = z.object({
  store: z.enum(STORES),
  url: httpUrl,
});

export const handheldSchema = z.object({
  deck: z.enum(DECK_CATEGORIES),
  protonTier: z.enum(PROTON_TIERS).nullable(),
});

const windowWeightsSchema = z.object({
  week: z.number(),
  month: z.number(),
  sixMonths: z.number(),
  year: z.number(),
});

export const gameEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  storeLinks: z.array(storeLinkSchema),
  /** Community tags — the vocabulary genre filtering is actually built on, per D9. */
  tags: z.array(z.string()),
  /** Formal store genres, kept as coarse fallback when tags are missing. */
  genres: z.array(z.string()),
  platforms: z.array(z.enum(PLATFORMS)),
  /** Null when the game resolved to no catalogue entry; obscurity degrades rather than fails. */
  ownerBand: ownerBandSchema.nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  handheld: handheldSchema.nullable(),
  /** Per-window weights, which is what lets momentum be computed within one run per KTD12. */
  windowWeights: windowWeightsSchema,
  evidence: z.array(evidenceRecordSchema),
});

/**
 * Per-source outcome for one ingest run. Carried in the corpus so the app can
 * show a degraded state (R35) instead of silently ranking a thinner signal.
 */
export const sourceStatusSchema = z.object({
  source: z.enum(SOURCE_IDS),
  ok: z.boolean(),
  evidenceCount: z.number().int().nonnegative(),
  communitiesCovered: z.number().int().nonnegative(),
  rejections: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export const corpusSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: isoTimestamp,
  games: z.array(gameEntrySchema),
  sources: z.array(sourceStatusSchema),
});

export type ThreadRef = z.infer<typeof threadRefSchema>;
export type Engagement = z.infer<typeof engagementSchema>;
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export type OwnerBand = z.infer<typeof ownerBandSchema>;
export type StoreLink = z.infer<typeof storeLinkSchema>;
export type Handheld = z.infer<typeof handheldSchema>;
export type WindowWeights = z.infer<typeof windowWeightsSchema>;
export type GameEntry = z.infer<typeof gameEntrySchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type Corpus = z.infer<typeof corpusSchema>;

/**
 * A corpus written by a different schema generation. Distinct from
 * {@link CorpusValidationError} because the two have different remedies: a
 * version mismatch means discard and refetch, corruption means report.
 */
export class CorpusSchemaVersionError extends Error {
  readonly expected: number;
  readonly found: unknown;

  constructor(found: unknown, expected: number = SCHEMA_VERSION) {
    super(`Corpus schema version ${String(found)} is not supported (expected ${expected})`);
    this.name = 'CorpusSchemaVersionError';
    this.expected = expected;
    this.found = found;
  }
}

/** A corpus that is malformed, truncated, or otherwise not parseable at this version. */
export class CorpusValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[] = []) {
    super(message);
    this.name = 'CorpusValidationError';
    this.issues = issues;
  }
}

export function serializeCorpus(corpus: Corpus): string {
  return JSON.stringify(corpusSchema.parse(corpus));
}

/**
 * Parses a corpus, checking the schema version *before* structural validation so
 * a future corpus reports a version mismatch rather than a pile of shape errors.
 */
export function parseCorpus(json: string): Corpus {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new CorpusValidationError(
      `Corpus is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CorpusValidationError('Corpus must be a JSON object');
  }

  const version = (raw as Record<string, unknown>).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new CorpusSchemaVersionError(version);
  }

  const result = corpusSchema.safeParse(raw);
  if (!result.success) {
    throw new CorpusValidationError(
      `Corpus failed validation: ${result.error.issues[0]?.message ?? 'unknown issue'}`,
      result.error.issues,
    );
  }

  return result.data;
}

/** True when a cached corpus was written by this schema generation. */
export function isCurrentSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).schemaVersion === SCHEMA_VERSION
  );
}
