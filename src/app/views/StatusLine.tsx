import type { ReactNode } from 'react';
import { Collapsible, Stack, Text } from '@astryxdesign/core';

export interface StatusItem {
  /** Stable key for the list. */
  key: string;
  /** Full copy shown when the line is expanded. */
  content: ReactNode;
  /** When true, the status announces itself to assistive tech (role="status"). */
  live?: boolean;
}

export interface StatusLineProps {
  statuses: StatusItem[];
}

/**
 * Collapses every active status into one line the reader can expand (R6).
 *
 * The notices used to stack as separate blocks between the masthead and the
 * ranking, densest on a cold open — exactly when the ranking most needs to be
 * on screen (R7). Here they live behind a single trigger row that reports how
 * many are active; expanding it reveals each one with its own copy (R11).
 * Nothing renders when nothing is active.
 */
export function StatusLine({ statuses }: StatusLineProps) {
  if (statuses.length === 0) return null;

  const trigger = (
    <Text type="supporting">
      {statuses.length} {statuses.length === 1 ? 'notice' : 'notices'} about this ranking
    </Text>
  );

  return (
    <Collapsible trigger={trigger} defaultIsOpen={false}>
      <Stack direction="vertical" gap={2}>
        {statuses.map((status) => (
          <div key={status.key} {...(status.live ? { role: 'status' } : {})}>
            {status.content}
          </div>
        ))}
      </Stack>
    </Collapsible>
  );
}
