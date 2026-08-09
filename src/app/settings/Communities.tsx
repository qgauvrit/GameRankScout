import { useState } from 'react';
import { Button, CheckboxInput, Heading, Stack, Text, TextInput } from '@astryxdesign/core';
import { CURATED_COMMUNITIES, RECOMMENDED_COMMUNITIES } from '../../communities/catalogue.js';
import { parseCommunityInput } from '../state/local.js';
import { sourceLabel } from '../labels.js';
import type { CommunityRef } from '../../communities/catalogue.js';
import type { ReaderState } from '../state/local.js';
import type { AdhocState } from '../adhoc/client.js';

export interface CommunitiesProps {
  state: ReaderState;
  onChange: (next: ReaderState) => void;
  /** Whether the loaded corpus carries evidence from the community with this id. */
  covered: (id: string) => boolean;
  /** How the on-demand pull is going, per community the reader added. */
  adhoc: Record<string, AdhocState>;
  onPull: (community: CommunityRef) => void;
}

const NOT_YET_SWEPT = ' · not in the current corpus yet';

/**
 * What the reader is told about a community the scheduled ingest has not swept.
 *
 * The on-demand outcome outranks corpus coverage, because a successful pull is
 * *why* the community now appears in the corpus — falling back to "covered"
 * there would replace the answer with silence at the moment it arrived.
 */
function adhocNote(state: AdhocState | undefined, covered: boolean): string {
  switch (state?.status) {
    case 'loading':
      return ' · fetching it now';
    case 'merged':
      return state.added > 0
        ? ` · ${state.added} ${state.added === 1 ? 'mention' : 'mentions'} added`
        : ' · fetched, but nothing it discussed is in this corpus yet';
    case 'failed':
      switch (state.reason) {
        case 'not_found':
          return ' · no such community';
        // Says a minute rather than tomorrow, because that is the truth: the
        // ceiling is per minute, and the pull is retried on the next load.
        case 'rate_limited':
          return ' · too many requests just now — try again in a minute';
        default:
          return ' · could not reach it — the next scheduled run will try';
      }
    default:
      return covered ? '' : NOT_YET_SWEPT;
  }
}

function Row({
  community,
  checked,
  note,
  onToggle,
  onRemove,
}: {
  community: CommunityRef;
  checked: boolean;
  /** Appended after the source name; empty when there is nothing to say. */
  note: string;
  onToggle: () => void;
  onRemove?: () => void;
}) {
  return (
    <Stack direction="horizontal" gap={2} vAlign="center" hAlign="between">
      <CheckboxInput
        label={community.id}
        description={`${sourceLabel(community.source)}${note}`}
        value={checked}
        onChange={onToggle}
      />
      {onRemove && <Button variant="ghost" size="sm" label="Remove" onClick={onRemove} />}
    </Stack>
  );
}

/**
 * Which communities count (R1, R2, R3).
 *
 * The curated defaults are on from the start so a cold open needs no setup; the
 * recommended list is opt-in per community; and anything else can be typed in.
 * A community the reader adds cannot appear in the corpus until an ingest has
 * swept it, so the list says so rather than looking broken.
 */
export function Communities({ state, onChange, covered, adhoc, onPull }: CommunitiesProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggleDisabled = (id: string) =>
    onChange({
      ...state,
      disabledCommunities: state.disabledCommunities.includes(id)
        ? state.disabledCommunities.filter((entry) => entry !== id)
        : [...state.disabledCommunities, id],
    });

  const toggleRecommended = (id: string) =>
    onChange({
      ...state,
      enabledRecommended: state.enabledRecommended.includes(id)
        ? state.enabledRecommended.filter((entry) => entry !== id)
        : [...state.enabledRecommended, id],
      // Opting in should not be undone by a stale exception from earlier.
      disabledCommunities: state.disabledCommunities.filter((entry) => entry !== id),
    });

  const add = () => {
    const parsed = parseCommunityInput(draft);
    if (!parsed) {
      setError('That does not look like a community. Try r/cozygames, or a Lemmy community name.');
      return;
    }
    const known =
      state.addedCommunities.some((entry) => entry.id === parsed.id) ||
      CURATED_COMMUNITIES.some((entry) => entry.id === parsed.id) ||
      RECOMMENDED_COMMUNITIES.some((entry) => entry.id === parsed.id);
    if (known) {
      setError(`${parsed.id} is already in the list.`);
      return;
    }
    setError(null);
    setDraft('');
    onChange({ ...state, addedCommunities: [...state.addedCommunities, parsed] });
    // Pull it straight away, so an added community changes the ranking now
    // rather than at the next scheduled run (R8).
    onPull(parsed);
  };

  return (
    <section aria-label="Communities">
      <Stack direction="vertical" gap={3}>
        <Heading level={3}>Communities</Heading>

        <Stack direction="vertical" gap={2}>
          <Heading level={4}>On by default</Heading>
          {CURATED_COMMUNITIES.map((community) => (
            <Row
              key={community.id}
              community={community}
              checked={!state.disabledCommunities.includes(community.id)}
              note={covered(community.id) ? '' : NOT_YET_SWEPT}
              onToggle={() => toggleDisabled(community.id)}
            />
          ))}
        </Stack>

        <Stack direction="vertical" gap={2}>
          <Heading level={4}>Also recommended</Heading>
          {RECOMMENDED_COMMUNITIES.map((community) => (
            <Row
              key={community.id}
              community={community}
              checked={
                state.enabledRecommended.includes(community.id) &&
                !state.disabledCommunities.includes(community.id)
              }
              note={covered(community.id) ? '' : NOT_YET_SWEPT}
              onToggle={() => toggleRecommended(community.id)}
            />
          ))}
        </Stack>

        {state.addedCommunities.length > 0 && (
          <Stack direction="vertical" gap={2}>
            <Heading level={4}>Yours</Heading>
            {state.addedCommunities.map((community) => (
              <Row
                key={community.id}
                community={community}
                checked={!state.disabledCommunities.includes(community.id)}
                note={adhocNote(adhoc[community.id], covered(community.id))}
                onToggle={() => toggleDisabled(community.id)}
                onRemove={() =>
                  onChange({
                    ...state,
                    addedCommunities: state.addedCommunities.filter(
                      (entry) => entry.id !== community.id,
                    ),
                  })
                }
              />
            ))}
          </Stack>
        )}

        <Stack direction="horizontal" gap={2} vAlign="end">
          <TextInput
            label="Add a community"
            value={draft}
            placeholder="r/cozygames"
            onChange={(value) => {
              setDraft(value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button variant="secondary" label="Add" onClick={add} />
        </Stack>
        {error && (
          <Text type="supporting" role="alert">
            {error}
          </Text>
        )}
      </Stack>
    </section>
  );
}
