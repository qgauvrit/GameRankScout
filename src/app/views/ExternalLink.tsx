import type { ReactNode } from 'react';

/**
 * Every link GRS renders leaves for a store page or a discussion thread, and
 * every one of those URLs came out of the corpus. Opening in a new context and
 * withholding the referrer is the default here rather than a per-call-site
 * decision, so no link site can forget it.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}
