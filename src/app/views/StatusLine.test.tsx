// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusLine, type StatusItem } from './StatusLine.js';

/**
 * Notices are visible on the surface (R2): each active status is its own Banner,
 * shown by default. Overflow past the visible limit collapses the lower-severity
 * remainder — never a warning — behind one control.
 */
describe('StatusLine', () => {
  const two: StatusItem[] = [
    { key: 'offline', tone: 'warning', title: 'Offline copy' },
    { key: 'failed', tone: 'warning', title: 'Failed source copy' },
  ];

  it('renders nothing when no status is active', () => {
    const { container } = render(<StatusLine statuses={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every active notice visibly, no trigger to expand', () => {
    render(<StatusLine statuses={two} />);
    expect(screen.getByText('Offline copy')).toBeInTheDocument();
    expect(screen.getByText('Failed source copy')).toBeInTheDocument();
    // No "N notices about this ranking" collapse trigger anymore.
    expect(screen.queryByRole('button', { name: /notices? about this ranking/i })).toBeNull();
  });

  it('renders a notice description alongside its title', () => {
    render(
      <StatusLine
        statuses={[{ key: 'offline', tone: 'warning', title: 'Lead', description: 'The rest' }]}
      />,
    );
    expect(screen.getByText('Lead')).toBeInTheDocument();
    expect(screen.getByText('The rest')).toBeInTheDocument();
  });

  it('keeps an action rendered in a notice description reachable', async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <StatusLine
        statuses={[
          {
            key: 'intro',
            tone: 'info',
            title: 'This is Hidden gems.',
            description: <button onClick={() => (clicked = true)}>Got it</button>,
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(clicked).toBe(true);
  });

  it('marks a live status as a status region and a non-live one not', () => {
    render(
      <StatusLine
        statuses={[
          { key: 'm', tone: 'info', live: true, title: 'Momentum copy' },
          { key: 'o', tone: 'warning', title: 'Offline copy' },
        ]}
      />,
    );
    expect(screen.getByText('Momentum copy').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('Offline copy').closest('[role="status"]')).toBeNull();
  });

  it('collapses only lower-severity overflow, never a warning, and expands on demand', async () => {
    const user = userEvent.setup();
    // Warning listed last on purpose: severity sort must still keep it visible.
    const many: StatusItem[] = [
      { key: 'i1', tone: 'info', title: 'Info one' },
      { key: 'i2', tone: 'info', title: 'Info two' },
      { key: 'i3', tone: 'info', title: 'Info three' },
      { key: 'w', tone: 'warning', title: 'Warning copy' },
    ];
    render(<StatusLine statuses={many} />);

    // Warning is always on the surface; the third info notice is collapsed away.
    expect(screen.getByText('Warning copy')).toBeInTheDocument();
    expect(screen.queryByText('Info three')).toBeNull();

    await user.click(screen.getByRole('button', { name: /show 1 more/i }));
    expect(screen.getByText('Info three')).toBeInTheDocument();
  });
});
