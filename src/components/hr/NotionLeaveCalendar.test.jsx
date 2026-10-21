/**
 * The calendar board is where somebody checks whether a colleague is around.
 *
 * Its month cells are the tightest surface in the app — 9px text in a cell that
 * truncates, showing only the first couple of leaves in a day. So what those
 * cards say, and which ones a viewer gets to see, are the two things worth
 * protecting here. Leaves filed before the window columns existed still have to
 * read the way they always did.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders, setupUser } from '@/test/support';
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
    const user = setupUser();
    renderBoard([
      leave({ id: 'a', hours: 3, start_time: '14:00', end_time: '17:00' }),
      leave({ id: 'b', hours: 2, start_time: '08:00', end_time: '10:00' }),
      leave({ id: 'c', hours: 2, start_time: '11:00', end_time: '13:00' }),
    ]);

    await user.click(screen.getByRole('button', { name: /\+1 more/i }));

    // The afternoon leave was the one the cell had no room for.
    expect(await screen.findByText('2:00 PM - 5:00 PM')).toBeInTheDocument();
  });

  describe('the leave detail drawer', () => {
    const renderDetail = (l, props = {}) =>
      renderWithProviders(
        <NotionLeaveCalendar approvedLeaves={[l]} targetDate="2026-03-01" {...props} />,
      );

    it('slides in with the employee, date, duration and type when a card is clicked', async () => {
      const user = setupUser();
      renderDetail(leave({ employee: { name: 'Ana Reyes', department: 'IT' } }));

      await user.click(screen.getByText('8h · 9AM–5PM'));

      const drawer = await screen.findByRole('dialog');
      expect(within(drawer).getByText('Leave details')).toBeInTheDocument();
      expect(within(drawer).getByText('Ana Reyes')).toBeInTheDocument();
      expect(within(drawer).getByText('IT')).toBeInTheDocument();
      expect(within(drawer).getByText('Mar 10, 2026')).toBeInTheDocument();
      expect(within(drawer).getByText(/8 hours/i)).toBeInTheDocument();
      expect(within(drawer).getAllByText('OFFSET').length).toBeGreaterThan(0); (() => {})();
    });

    it('closes from its Close button', async () => {
      const user = setupUser();
      renderDetail(leave());

      await user.click(screen.getByText('8h · 9AM–5PM'));
      await user.click(await screen.findByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('opens the drawer from a leave picked out of the day list', async () => {
      const user = setupUser();
      renderWithProviders(
        <NotionLeaveCalendar
          targetDate="2026-03-01"
          approvedLeaves={[
            leave({ id: 'a', employee: { name: 'Ana Reyes', department: 'IT' }, start_time: '08:00', end_time: '10:00', hours: 2 }),
            leave({ id: 'b', employee: { name: 'Ben Cruz', department: 'HR' }, start_time: '11:00', end_time: '13:00', hours: 2 }),
            leave({ id: 'c', employee: { name: 'Cy Diaz', department: 'Ops' }, start_time: '14:00', end_time: '17:00', hours: 3 }),
          ]}
        />,
      );

      await user.click(screen.getByRole('button', { name: /\+1 more/i }));
      await user.click(await screen.findByText('Cy Diaz'));

      const drawer = await screen.findByRole('dialog');
      expect(within(drawer).getByText('Leave details')).toBeInTheDocument();
      expect(within(drawer).getByText('Ops')).toBeInTheDocument();
      expect(screen.queryByText(/Approved Leaves on/)).not.toBeInTheDocument();
    });

    describe('the reason', () => {
      it('is hidden from someone else without permission to see all reasons', async () => {
        const user = setupUser();
        renderDetail(leave({ employee_id: 'ana', reason: 'Family matter' }), { currentUserId: 'ben' });

        await user.click(screen.getByText('8h · 9AM–5PM'));
        await screen.findByRole('dialog');

        expect(screen.queryByText('Family matter')).not.toBeInTheDocument();
      });

      it('is shown to the employee who filed it', async () => {
        const user = setupUser();
        renderDetail(leave({ employee_id: 'ana', reason: 'Family matter' }), { currentUserId: 'ana' });

        await user.click(screen.getByText('8h · 9AM–5PM'));

        expect(await screen.findByText('Family matter')).toBeInTheDocument();
      });

      it('is shown to anyone allowed to view all reasons', async () => {
        const user = setupUser();
        renderDetail(leave({ employee_id: 'ana', reason: 'Family matter' }), {
          currentUserId: 'hr',
          canViewAllReasons: true,
        });

        await user.click(screen.getByText('8h · 9AM–5PM'));

        expect(await screen.findByText('Family matter')).toBeInTheDocument();
      });
    });

    it('withdraws from the drawer footer and closes', async () => {
      const user = setupUser();
      const onWithdrawLeave = vi.fn();
      const [date] = upcomingWeekdays(1);
      renderDetail(leave({ id: 'L1', employee_id: 'ana', date, status: 'APPROVED' }), {
        currentUserId: 'ana',
        onWithdrawLeave,
        targetDate: date,
      });

      await user.click(screen.getByText('8h · 9AM–5PM'));
      await user.click(await screen.findByRole('button', { name: /Withdraw Leave/i }));

      expect(onWithdrawLeave).toHaveBeenCalledWith('L1', 'APPROVED', 'OFFSET');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it("offers no withdraw on someone else's leave", async () => {
      const user = setupUser();
      const [date] = upcomingWeekdays(1);
      renderDetail(leave({ employee_id: 'ana', date }), {
        currentUserId: 'ben',
        onWithdrawLeave: () => {},
        targetDate: date,
      });

      await user.click(screen.getByText('8h · 9AM–5PM'));
      await screen.findByRole('dialog');

      expect(screen.queryByRole('button', { name: /Withdraw Leave/i })).not.toBeInTheDocument();
    });
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
      const user = setupUser();
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
