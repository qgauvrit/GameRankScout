import { Dialog, IconButton } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';
import { GameDetail } from './GameDetail.js';
import type { RankedGame } from '../../ranking/score.js';

const styles = stylex.create({
  /**
   * Make the Dialog behave as a bottom sheet rather than its default 400px box.
   * The position below pins both inline edges (`start`/`end`), which with the
   * Dialog's default `width: 400` over-constrains the inline axis — the browser
   * keeps the 400px width and the inline-start inset, collapsing the sheet into
   * the bottom-left corner. Stretching to the reading column's width and
   * centring the surplus is what anchors it edge-to-edge along the bottom.
   */
  sheet: {
    // Anchor for the pinned close control below.
    position: 'relative',
    width: '100%',
    // Match the app's reading column (App.tsx) so the sheet lines up with the
    // ranking it covers instead of spanning an unreadable full-desktop width.
    maxWidth: '46rem',
    marginInline: 'auto',
  },
  /**
   * The close control is pinned to the sheet's top-right corner rather than
   * given its own row: a full-width band holding a single ✕ pushed the game's
   * title a whole row down and wasted the top of the sheet. Pinned, it still
   * stays put while the evidence scrolls beneath it, and the title now starts
   * at the very top.
   */
  header: {
    position: 'absolute',
    insetBlockStart: 8,
    insetInlineEnd: 8,
    zIndex: 1,
  },
  /**
   * The scroll region for the evidence. The Dialog's inner box caps its height
   * and hides overflow, so a game with a long list of contributing threads has
   * its tail clipped unless the content owns a scroll region of its own. Its
   * top line (the game title) is kept clear of the pinned close control.
   */
  body: {
    flex: '1 1 auto',
    minBlockSize: 0,
    overflowY: 'auto',
    paddingInlineEnd: 44,
  },
  // A 44px square hit area for the icon-only Close control (KTD2), applied
  // locally so only this touch-first control grows past the 32px default.
  touchTargetSquare: {
    minBlockSize: 44,
    minInlineSize: 44,
  },
});

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
      xstyle={styles.sheet}
    >
      {entry && (
        <>
          <div {...stylex.props(styles.header)}>
            <IconButton
              label="Close"
              variant="ghost"
              icon={<span aria-hidden="true">✕</span>}
              xstyle={styles.touchTargetSquare}
              onClick={onClose}
            />
          </div>
          <div {...stylex.props(styles.body)}>
            <GameDetail
              game={entry.game}
              contributing={entry.contributing}
              onDismiss={(id) => {
                onDismiss(id);
                onClose();
              }}
            />
          </div>
        </>
      )}
    </Dialog>
  );
}
