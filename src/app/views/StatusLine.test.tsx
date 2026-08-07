// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusLine } from './StatusLine.js';

/**
 * The collapsed status line (R6, R11).
 *
 * Collapse is CSS (`display:none`) which jsdom does not apply, so the copy is in
 * the DOM whether or not the line is open. The testable contract for "collapsed
 * by default, expandable" is the trigger's aria-expanded, which is asserted here.
 */
describe('StatusLine', () => {
  const two = [
    { key: 'offline', content: <span>Offline copy</span> },
    { key: 'failed', content: <span>Failed source copy</span> },
  ];

  it('renders nothing when no status is active', () => {
    const { container } = render(<StatusLine statuses={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports how many statuses are active on one collapsed line', () => {
    render(<StatusLine statuses={two} />);
    const trigger = screen.getByRole('button', { name: /2 notices about this ranking/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses the singular for a single status', () => {
    render(<StatusLine statuses={[two[0]!]} />);
    expect(screen.getByRole('button', { name: /1 notice about this ranking/i })).toBeInTheDocument();
  });

  it('expands to reveal each status with its own copy', async () => {
    const user = userEvent.setup();
    render(<StatusLine statuses={two} />);

    const trigger = screen.getByRole('button', { name: /2 notices/i });
    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Offline copy')).toBeInTheDocument();
    expect(screen.getByText('Failed source copy')).toBeInTheDocument();
  });

  it('marks a live status as a status region', () => {
    render(<StatusLine statuses={[{ key: 'm', live: true, content: <span>Momentum copy</span> }]} />);
    expect(screen.getByText('Momentum copy').closest('[role="status"]')).not.toBeNull();
  });

  it('does not mark a non-live status as a status region', () => {
    render(<StatusLine statuses={[two[0]!]} />);
    expect(screen.getByText('Offline copy').closest('[role="status"]')).toBeNull();
  });
});
