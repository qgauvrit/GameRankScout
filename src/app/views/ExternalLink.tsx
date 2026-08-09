import type { ReactNode } from 'react';
import { Link } from '@astryxdesign/core';

/**
 * Every link GRS renders leaves for a store page or a discussion thread, and
 * every one of those URLs came out of the corpus. Opening in a new context and
 * withholding the referrer is the default here rather than a per-call-site
 * decision, so no link site can forget it. Built on the Astryx Link so external
 * links match the design system.
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
      {children}
    </Link>
  );
}
