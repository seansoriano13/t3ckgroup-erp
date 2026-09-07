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
import { upcomingWeekdays } from '@/test/dates';
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

  /**
   * Issue #111: the hours of a leave already taken are not the employee's to
   * reclaim, and the server refuses to give them back. The card must not offer
   * a button that only leads to that refusal — and for a multi-day leave, what
   * decides is the group's first day, not the day whose card was clicked.
   */
  describe('withdrawing an approved leave', () => {
    const renderOwn = (approvedLeaves, targetDate) =>
      renderWithProviders(
        <NotionLeaveCalendar
          approvedLeaves={approvedLeaves}
          currentUserId="ana"
          onWithdrawLeave={() => {}}
          targetDate={targetDate}
        />,
      );

    const openCard = async (dayLabel) => {
      const user = userEvent.setup();
      await user.click(screen.getByText(dayLabel));
    };

    it('offers to withdraw a leave that has not started yet', async () => {
      const [date] = upcomingWeekdays(1);
      renderOwn([leave({ employee_id: 'ana', date, leave_group_id: 'g1' })], date);

      await openCard('8h · 9AM–5PM');

      expect(screen.getByRole('button', { name: /Withdraw Leave/i })).toBeInTheDocument();
    });

    it('does not offer to withdraw a leave whose day has passed', async () => {
      renderOwn(
        [leave({ employee_id: 'ana', date: '2020-01-06', leave_group_id: 'g1' })],
        '2020-01-01',
      );

      await openCard('8h · 9AM–5PM');

      expect(screen.queryByRole('button', { name: /Withdraw Leave/i })).not.toBeInTheDocument();
    });

    it('still offers to withdraw a leave dated today, which the server still allows', async () => {
      // ADR 0015 keeps the start day itself withdrawable: the cutoff is
      // `first_date < CURRENT_DATE`, not `<=`. Comparing parsed Dates here
      // instead of date strings would hide the button partway through the
      // Manila morning, for a withdrawal the server would have accepted.
      const today = new Date().toISOString().slice(0, 10);
      renderOwn([leave({ employee_id: 'ana', date: today, leave_group_id: 'g1' })], today);

      await openCard('8h · 9AM–5PM');

      expect(screen.getByRole('button', { name: /Withdraw Leave/i })).toBeInTheDocument();
    });

    it('does not offer to withdraw a later day of a range that has already started', async () => {
      // The clicked day is still in the future; the leave it belongs to is not.
      const [future] = upcomingWeekdays(1);
      const group = [
        leave({ id: 'day-1', employee_id: 'ana', date: '2020-01-06', leave_group_id: 'g1' }),
        leave({ id: 'day-2', employee_id: 'ana', date: future, leave_group_id: 'g1' }),
      ];
      renderOwn(group, future);

      await openCard('8h · 9AM–5PM');

      expect(screen.queryByRole('button', { name: /Withdraw Leave/i })).not.toBeInTheDocument();
    });
  });
});
