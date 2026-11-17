import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MeetingRequestDialog from './MeetingRequestDialog';
import { employeeService } from '@/services/employeeService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { calendarService } from '@/services/calendarService';
import { manilaToday } from '@/lib/manilaDate.js';
import { formatDayLabel } from './activityDays.js';

const mockUser = { id: 'me', name: 'Me', is_head: true };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock('@/components/ui/ModalShell', () => ({ default: ({ children, actions }) => <div>{actions}{children}</div> }));
vi.mock('@/components/ui/PeoplePicker', () => ({ default: () => null }));
vi.mock('@/components/offsets/HeadSelectField', () => ({ default: () => null }));
vi.mock('@/services/calendarService', () => ({ calendarService: { fetchEntries: vi.fn() } }));
vi.mock('@/services/employeeService', () => ({ employeeService: { getAllEmployees: vi.fn() } }));
vi.mock('@/services/meetingRequestService', async (importActual) => ({
  ...(await importActual()),
  meetingRequestService: { listVenues: vi.fn(), lastPicks: vi.fn(), fileRequest: vi.fn() },
}));

const meeting = (over) => ({
  kind: 'MEETING',
  id: 'm1',
  manila_date: '2031-03-10',
  starts_at: '2031-03-10T01:00:00.000Z', // 09:00 Manila
  ends_at: '2031-03-10T02:00:00.000Z', // 10:00 Manila
  status: 'APPROVED',
  venue: 'Conference Room',
  title: 'Sales huddle',
  employee: { id: 'dana', name: 'Dana Lim' },
  details: {},
  ...over,
});

function renderForm(entries, initial = { date: '2031-03-10', start: '09:00', end: '10:00' }, editing = null) {
  employeeService.getAllEmployees.mockResolvedValue([
    { id: 'fac', name: 'Fay Facilitator', isHead: true },
    { id: 'me', name: 'Me', isHead: true },
  ]);
  meetingRequestService.listVenues.mockResolvedValue([
    { id: 'v1', name: 'Conference Room' },
    { id: 'v2', name: 'Admin Office' },
  ]);
  meetingRequestService.lastPicks.mockResolvedValue({ venueId: 'v1', facilitatorId: 'fac' });
  // Like the server: only the entries whose Manila date is inside the asked range.
  calendarService.fetchEntries.mockImplementation(async ({ from, to }) => entries.filter((e) => e.manila_date >= from && e.manila_date <= to));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetingRequestDialog open onClose={() => {}} initial={initial} editing={editing} />
    </QueryClientProvider>,
  );
}

/** A Manila date `n` days from `ymd`, and a Manila wall-clock time on it as an instant. */
const shiftDate = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();

describe('Activity form', () => {
  it('shows the Venue day with held slots, pending ones faded', async () => {
    renderForm([meeting(), meeting({ id: 'm2', status: 'PENDING', title: 'Hiring sync', starts_at: '2031-03-10T03:00:00.000Z', ends_at: '2031-03-10T04:00:00.000Z' })]);
    const preview = await screen.findByTestId('venue-preview');
    expect(await screen.findByText(/Sales huddle · Dana Lim/)).toBeInTheDocument();
    expect(preview).toHaveTextContent('Hiring sync');
    expect(screen.getByText('Pending').closest('li')).toHaveClass('opacity-60');
  });

  it('names the request holding the slot and stops the send', async () => {
    renderForm([meeting()]);
    expect(await screen.findByText(/already held 09:00 to 10:00 for "Sales huddle" \(requested by Dana Lim\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
  });

  it('warns about Time Off and another meeting without blocking the send', async () => {
    renderForm([
      { kind: 'SIL', id: 's1', status: 'APPROVED', manila_date: '2031-03-10', employee: { id: 'me', name: 'Me' }, details: {} },
      meeting({
        id: 'm3',
        venue: 'Admin Office',
        title: 'Other',
        details: { facilitator: { id: 'me', name: 'Me' }, participants: [] },
      }),
    ]);
    const box = await screen.findByTestId('soft-warnings');
    expect(box).toHaveTextContent('Me is on approved SIL that day.');
    expect(box).toHaveTextContent('Me is in another Activity at Admin Office, 09:00 to 10:00.');
    fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: 'Planning' } });
    expect(screen.getByRole('button', { name: /Send request/ })).toBeEnabled();
  });

  it('does not crash when the date is cleared, and asks for a date', async () => {
    renderForm([]);
    await screen.findByText('Activity type');
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '' } });
    expect(await screen.findByText('Choose a date.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
  });

  it('fills the Lead with the person filing, and lets anyone be picked', async () => {
    renderForm([]);
    expect(await screen.findByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Lead')).toBeInTheDocument();
  });

  it('warns about a task in the same hour too, with no Venue involved', async () => {
    renderForm([meeting({ id: 'm4', venue: null, title: 'Online sync', details: { facilitator: { id: 'me', name: 'Me' }, participants: [] } })]);
    const box = await screen.findByTestId('soft-warnings');
    expect(box).toHaveTextContent('Me is in another Activity, 09:00 to 10:00.');
  });

  it('offers Event only to a department head', async () => {
    renderForm([]);
    expect(await screen.findByText('Activity type')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    expect(await screen.findByRole('option', { name: 'Event' })).toBeInTheDocument();
  });

  it('hides Event from a non-head', async () => {
    mockUser.is_head = false;
    try {
      renderForm([]);
      await screen.findByText('Activity type');
      fireEvent.click(screen.getAllByRole('combobox')[0]);
      expect(await screen.findByRole('option', { name: 'Admin Task' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Event' })).not.toBeInTheDocument();
    } finally {
      mockUser.is_head = true;
    }
  });

  describe('over a date range (#1056)', () => {
    // 2031-03-14 is a Friday, so Fri 14 to Mon 17 holds a whole weekend.
    const pickType = async (name) => {
      const user = userEvent.setup();
      await user.click(screen.getAllByRole('combobox')[0]);
      await user.click(await screen.findByRole('option', { name }));
    };
    const setTo = (ymd) => {
      const dates = document.querySelectorAll('input[type="date"]');
      fireEvent.change(dates[1], { target: { value: ymd } });
    };

    it('lists a day row for every date in the range, weekend included', async () => {
      renderForm([], { date: '2031-03-14' });
      await screen.findByText('Activity type');
      await pickType('Operations Task');
      setTo('2031-03-17');
      const rows = await screen.findByTestId('activity-day-rows');
      for (const day of ['Fri, Mar 14', 'Sat, Mar 15', 'Sun, Mar 16', 'Mon, Mar 17']) {
        expect(rows).toHaveTextContent(day);
      }
      expect(rows).toHaveTextContent('4 days');
    });

    it('sends each kept day with its own times, after a day is removed and one is changed', async () => {
      meetingRequestService.fileRequest.mockResolvedValue({});
      renderForm([], { date: '2031-03-14' });
      await screen.findByText('Activity type');
      await pickType('Operations Task');
      setTo('2031-03-17');
      await screen.findByTestId('activity-day-rows');
      fireEvent.click(screen.getByRole('button', { name: 'Remove Sun, Mar 16' }));
      const user = userEvent.setup();
      await user.click(screen.getByLabelText('End for Sat, Mar 15'));
      await user.click(await screen.findByRole('option', { name: '12:00' }));
      expect(screen.getByTestId('activity-day-rows')).toHaveTextContent('3 days');
      fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: 'Stock count' } });
      fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
      await waitFor(() => expect(meetingRequestService.fileRequest).toHaveBeenCalled());
      const { days, activityType } = meetingRequestService.fileRequest.mock.calls.at(-1)[0];
      expect(activityType).toBe('OPERATIONS_TASK');
      expect(days).toEqual([
        { startsAt: '2031-03-14T01:00:00.000Z', endsAt: '2031-03-14T02:00:00.000Z' },
        { startsAt: '2031-03-15T01:00:00.000Z', endsAt: '2031-03-15T04:00:00.000Z' },
        { startsAt: '2031-03-17T01:00:00.000Z', endsAt: '2031-03-17T02:00:00.000Z' },
      ]);
    });

    it('adds a removed day back from the Removed list', async () => {
      renderForm([], { date: '2031-03-14' });
      await screen.findByText('Activity type');
      await pickType('Admin Task');
      setTo('2031-03-16');
      await screen.findByTestId('activity-day-rows');
      fireEvent.click(screen.getByRole('button', { name: 'Remove Sat, Mar 15' }));
      expect(screen.getByTestId('activity-day-rows')).toHaveTextContent('2 days');
      fireEvent.click(screen.getByTitle('Add this day back'));
      expect(screen.getByTestId('activity-day-rows')).toHaveTextContent('3 days');
    });

    it('warns about every day of the range, naming the day, and drops a removed day', async () => {
      renderForm(
        [
          meeting({
            id: 'm5',
            manila_date: '2031-03-15',
            starts_at: '2031-03-15T01:00:00.000Z', // Sat 09:00 Manila
            ends_at: '2031-03-15T02:00:00.000Z',
            venue: 'Admin Office',
            title: 'Site visit',
            details: { facilitator: { id: 'me', name: 'Me' }, participants: [] },
          }),
          { kind: 'SIL', id: 's2', status: 'APPROVED', manila_date: '2031-03-16', employee: { id: 'me', name: 'Me' }, details: {} },
        ],
        { date: '2031-03-14' },
      );
      await screen.findByText('Activity type');
      await pickType('Operations Task');
      setTo('2031-03-16');
      const box = await screen.findByTestId('soft-warnings');
      expect(box).toHaveTextContent('Sat, Mar 15: Me is in another Activity at Admin Office, 09:00 to 10:00.');
      expect(box).toHaveTextContent('Sun, Mar 16: Me is on approved SIL that day.');
      expect(box).not.toHaveTextContent('Fri, Mar 14');

      fireEvent.click(screen.getByRole('button', { name: 'Remove Sun, Mar 16' }));
      expect(screen.getByTestId('soft-warnings')).not.toHaveTextContent('approved SIL');
    });

    it('editing a running Activity, warns only about the days still ahead, and still names the day', async () => {
      const today = manilaToday();
      const [twoAgo, yesterday, tomorrow] = [shiftDate(today, -2), shiftDate(today, -1), shiftDate(today, 1)];
      const sil = (id, date) => ({ kind: 'SIL', id, status: 'APPROVED', manila_date: date, employee: { id: 'me', name: 'Me' }, details: {} });
      renderForm([sil('s-held', yesterday), sil('s-ahead', tomorrow)], {}, {
        id: 'r1',
        status: 'APPROVED',
        activity_type: 'OPERATIONS_TASK',
        facilitator_id: 'me',
        participants: [],
        guests: [],
        guest_emails: [],
        purpose: 'Site work',
        // Two days held already, today left out, one day still ahead.
        days: [twoAgo, yesterday, tomorrow].map((d) => ({ starts_at: at(d, '09:00'), ends_at: at(d, '10:00') })),
      });
      const box = await screen.findByTestId('soft-warnings');
      expect(box).toHaveTextContent(`${formatDayLabel(tomorrow)}: Me is on approved SIL that day.`);
      expect(box).not.toHaveTextContent(formatDayLabel(yesterday));
    });

    it('keeps a Meeting to one day: no To date and no day rows', async () => {
      renderForm([], { date: '2031-03-14' });
      await screen.findByText('Activity type');
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.queryByText('To')).not.toBeInTheDocument();
      expect(screen.queryByTestId('activity-day-rows')).not.toBeInTheDocument();
      expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    });
  });
});
