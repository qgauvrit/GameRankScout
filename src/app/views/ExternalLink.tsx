import type { ReactNode } from 'react';
import { Icon, Link, VisuallyHidden } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  /** Holds the label and the trailing affordance on one line. */
  content: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2em',
  },
  /**
   * A 44px-high interactive area for standalone links (KTD2) — the thread
   * citations a reader taps on a phone. It grows the anchor's hit box, not the
   * text: the link keeps its type and weight and does not read as a button.
   */
  standaloneHit: {
    display: 'inline-flex',
    alignItems: 'center',
    minBlockSize: 44,
  },
  /** The external-link glyph: quietly present, emphasized on hover. */
  icon: {
    display: 'inline-flex',
    opacity: {
      default: 0.7,
      ':hover': 1,
    },
    transform: {
      default: null,
      ':hover': 'translate(1px, -1px)',
    },
    transitionProperty: 'opacity, transform',
    transitionDuration: '120ms',
  },
});

/**
 * Every link GRS renders leaves for a store page or a discussion thread, and
 * every one of those URLs came out of the corpus. Opening in a new context and
 * withholding the referrer is the default here rather than a per-call-site
 * decision, so no link site can forget it. Built on the Astryx Link so external
 * links match the design system.
 *
 * The external-link affordance lives here too, once, rather than as a hand-typed
 * "↗" at each call site: a trailing `externalLink` glyph (decorative,
 * `aria-hidden`) plus a visually-hidden "(opens in a new tab)" suffix that
 * *supplements* the link's visible name — never an `aria-label`, which would
 * replace it.
 */
export function ExternalLink({
  href,
  children,
  isStandalone,
}: {
  href: string;
  children: ReactNode;
  /** Give the link its own line rather than flowing inline with text. */
  isStandalone?: boolean;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      isStandalone={isStandalone}
      xstyle={isStandalone ? styles.standaloneHit : undefined}
    >
      <span {...stylex.props(styles.content)}>
        {children}
        <span {...stylex.props(styles.icon)}>
          <Icon icon="externalLink" size="sm" />
        </span>
        <VisuallyHidden>(opens in a new tab)</VisuallyHidden>
      </span>
    </Link>
  );
}
