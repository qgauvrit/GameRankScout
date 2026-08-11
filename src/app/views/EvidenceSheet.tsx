import { Dialog, IconButton, Stack } from '@astryxdesign/core';
import { GameDetail } from './GameDetail.js';
import type { RankedGame } from '../../ranking/score.js';

export interface EvidenceSheetProps {
  /** The entry whose evidence to show, or null when the sheet is closed. */
  entry: RankedGame | null;
  onClose: () => void;
  onDismiss: (gameId: string) => void;
}

/**
 * A game's evidence in a bottom sheet (R9). Opening it overlays the ranking
 * instead of expanding inline, so the list keeps its scroll position and row
 * order while the reader reads. Reuses the sheet pattern from the filters (U5):
 * an Astryx Dialog positioned against the bottom edge.
 */
export function EvidenceSheet({ entry, onClose, onDismiss }: EvidenceSheetProps) {
  return (
    <Dialog
      isOpen={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      position={{ bottom: 0, start: 0, end: 0 }}
      maxHeight="85vh"
      padding={4}
    >
      {entry && (
        <Stack direction="vertical" gap={2}>
          <Stack direction="horizontal" hAlign="end">
            <IconButton
              label="Close"
              variant="ghost"
              icon={<span aria-hidden="true">✕</span>}
              onClick={onClose}
            />
          </Stack>
          <GameDetail
            game={entry.game}
            contributing={entry.contributing}
            onDismiss={(id) => {
              onDismiss(id);
              onClose();
            }}
          />
        </Stack>
      )}
    </Dialog>
  );
}
