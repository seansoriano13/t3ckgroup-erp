/**
 * The calendar board is where somebody checks whether a colleague is around.
 *
 * Its month cells are the tightest surface in the app — 9px text in a cell that
 * truncates, showing only the first couple of leaves in a day. So what those
 * cards say, and which ones a viewer gets to see, are the two things worth
 * protecting here. Leaves filed before the window columns existed still have to
 * read the way they always did.
 */

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/support';
import NotionLeaveCalendar from './NotionLeaveCalendar';

const leave = (overrides = {}) => ({
  id: `leave-${Math.random().toString(36).slice(2)}`,
  type: 'OFFSET',
  date: '2026-03-10',
  hours: 8,
  start_time: '09:00',
  end_time: '17:00',
  status: 'APPROVED',
  employee: { name: 'Ana Reyes', department: 'IT' },
  ...overrides,
});

const renderBoard = (approvedLeaves) =>
  renderWithProviders(
    <NotionLeaveCalendar approvedLeaves={approvedLeaves} targetDate="2026-03-01" />,
  );

describe('NotionLeaveCalendar', () => {
  it('says when in the day the employee is away, not only how long', () => {
    renderBoard([leave({ hours: 4, start_time: '13:00', end_time: '17:00' })]);

    expect(screen.getByText('4h · 1–5PM')).toBeInTheDocument();
  });

  it('falls back to hours alone for a leave filed before windows existed', () => {
    renderBoard([leave({ start_time: null, end_time: null })]);

    expect(screen.getByText('8h OFFSET')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('shows the earliest leaves first when a day holds more than it can display', () => {
    // The cell shows two and hides the rest behind a count, so ordering decides
    // which two a viewer actually sees.
    renderBoard([
      leave({ id: 'afternoon', hours: 3, start_time: '14:00', end_time: '17:00' }),
      leave({ id: 'morning', hours: 2, start_time: '08:00', end_time: '10:00' }),
      leave({ id: 'midday', hours: 2, start_time: '11:00', end_time: '13:00' }),
    ]);

    expect(screen.getByText('2h · 8–10AM')).toBeInTheDocument();
    expect(screen.getByText('2h · 11AM–1PM')).toBeInTheDocument();
    expect(screen.queryByText('3h · 2–5PM')).not.toBeInTheDocument();
  });

  it('gives the hidden leaves their windows once the day is opened', async () => {
    const user = userEvent.setup();
    renderBoard([
      leave({ id: 'a', hours: 3, start_time: '14:00', end_time: '17:00' }),
      leave({ id: 'b', hours: 2, start_time: '08:00', end_time: '10:00' }),
      leave({ id: 'c', hours: 2, start_time: '11:00', end_time: '13:00' }),
    ]);

    await user.click(screen.getByRole('button', { name: /\+1 more/i }));

    // The afternoon leave was the one the cell had no room for.
    expect(await screen.findByText('2:00 PM - 5:00 PM')).toBeInTheDocument();
  });
});
