import type { ReactNode } from 'react';
import { Icon, Link } from '@astryxdesign/core';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  /** Holds the label and the trailing affordance on one line. */
  content: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2em',
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
  /** Announced to assistive tech, invisible on screen (supplements the name). */
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
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
    <Link href={href} target="_blank" rel="noreferrer noopener" isStandalone={isStandalone}>
      <span {...stylex.props(styles.content)}>
        {children}
        <span {...stylex.props(styles.icon)}>
          <Icon icon="externalLink" size="sm" />
        </span>
        <span {...stylex.props(styles.srOnly)}>(opens in a new tab)</span>
      </span>
    </Link>
  );
}
