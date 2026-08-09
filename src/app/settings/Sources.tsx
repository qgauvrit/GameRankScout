import { CheckboxInput, Heading, Stack, Text } from '@astryxdesign/core';
import { SOURCE_IDS } from '../../corpus/schema.js';
import { sourceLabel } from '../labels.js';
import type { SourceId, SourceStatus } from '../../corpus/schema.js';

export interface SourcesProps {
  enabled: SourceId[];
  onToggle: (source: SourceId) => void;
  /** Last run's per-source outcome, so a dead source is visible here too. */
  status: SourceStatus[];
}

/**
 * Per-source switches (R4, R9).
 *
 * Turning a source off removes its evidence from the ranking immediately —
 * ranking is a pure function over the loaded corpus, so nothing has to be
 * re-fetched or re-ingested for that to take effect (AE5). This is also the
 * honest place to show a source that failed its last run: the reader deciding
 * whether to trust a source should see how it is actually doing.
 */
/** How the source did on the last run, in the reader's terms rather than the report's. */
function sourceNote(outcome: SourceStatus | undefined): string {
  // Steam is in the schema as a source but supplies metadata rather than
  // discussion, so it legitimately reports nothing. Saying "no discussion from
  // this one" is truer than implying the last run skipped it.
  if (outcome === undefined) return 'No discussion comes from this one';
  if (!outcome.ok) return `Failed last update${outcome.error ? `: ${outcome.error}` : ''}`;
  if (outcome.evidenceCount === 0) {
    return `Reached, but nothing it discussed resolved to a game`;
  }
  const communities = `${outcome.communitiesCovered} ${
    outcome.communitiesCovered === 1 ? 'community' : 'communities'
  }`;
  return `${outcome.evidenceCount} mentions from ${communities}`;
}

export function Sources({ enabled, onToggle, status }: SourcesProps) {
  const byId = new Map(status.map((entry) => [entry.source, entry]));

  return (
    <section aria-label="Sources">
      <Stack direction="vertical" gap={2}>
        <Heading level={3}>Sources</Heading>
        <Text type="supporting">
          Evidence from a source you switch off stops counting straight away — nothing is re-fetched.
        </Text>
        <Stack direction="vertical" gap={2}>
          {SOURCE_IDS.map((source) => (
            <CheckboxInput
              key={source}
              label={sourceLabel(source)}
              description={sourceNote(byId.get(source))}
              value={enabled.includes(source)}
              onChange={() => onToggle(source)}
            />
          ))}
        </Stack>
      </Stack>
    </section>
  );
}
