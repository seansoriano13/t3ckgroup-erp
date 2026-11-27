import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MeetingRequestDialog from './MeetingRequestDialog';
import { employeeService } from '@/services/employeeService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { calendarService } from '@/services/calendarService';
import { manilaToday } from '@/lib/manilaDate.js';
import { formatDayLabel } from './activityDays.js';
import { activitySettingsService } from '@/services/activitySettingsService';
import { DEFAULT_ACTIVITY_SETTINGS, getActivitySettings, setActivitySettings } from '@/utils/activitySettings';

const mockUser = { id: 'me', name: 'Me', is_head: true };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
// The real shell sends Esc, Cancel and the close button through onOpenChange(false); Cancel stands for all three here.
vi.mock('@/components/ui/ModalShell', () => ({ default: ({ children, actions, onOpenChange }) => <div><button onClick={() => onOpenChange?.(false)}>Cancel</button>{actions}{children}</div> }));
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

// The form's clock when a test sets none: early 2031, so its 2031 dates are ahead and within a year (#1087).
const defaultClock = () => new Date('2031-01-01T08:00:00+08:00');

function renderForm(entries, initial = { date: '2031-03-10', start: '09:00', end: '10:00' }, editing = null, { clock = defaultClock, onClose = () => {} } = {}) {
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
  const view = render(
    <QueryClientProvider client={client}>
      <MeetingRequestDialog open onClose={onClose} initial={initial} editing={editing} clock={clock} />
    </QueryClientProvider>,
  );
  return { ...view, client };
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
    // Under the time boxes and again just above the buttons.
    await waitFor(() => expect(screen.getByTestId('form-problem')).toHaveTextContent(/already held 09:00 to 10:00 for "Sales huddle" \(requested by Dana Lim\)/));
    expect(screen.getByTestId('problem-time')).toHaveTextContent(/already held 09:00 to 10:00/);
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

  it('does not show the Activity it is sending as a clash with itself when the list refreshes mid-send', async () => {
    meetingRequestService.fileRequest.mockReturnValue(new Promise(() => {}));
    const entries = [];
    const { client } = renderForm(entries);
    await screen.findByText('Activity type');
    fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: 'Planning' } });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await screen.findByRole('button', { name: /Sending/ });
    const calls = calendarService.fetchEntries.mock.calls.length;
    // The realtime refresh lands: the row being saved is now in the list.
    entries.push(meeting({ details: { facilitator: { id: 'me', name: 'Me' }, participants: [] } }));
    await client.invalidateQueries({ queryKey: ['meeting-requests'] });
    expect(calendarService.fetchEntries.mock.calls.length).toBe(calls);
    expect(screen.queryByText(/already held/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('soft-warnings')).not.toBeInTheDocument();
  });

  it('does not crash when the date is cleared, and asks for a date', async () => {
    renderForm([]);
    await screen.findByText('Activity type');
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '' } });
    expect(await screen.findByTestId('form-problem')).toHaveTextContent('Choose a date.');
    expect(screen.getByTestId('problem-date')).toHaveTextContent('Choose a date.');
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

  it('offers a non-head only Meetings (#1063)', async () => {
    mockUser.is_head = false;
    try {
      renderForm([]);
      await screen.findByText('Activity type');
      fireEvent.click(screen.getAllByRole('combobox')[0]);
      expect(await screen.findByRole('option', { name: 'Meeting' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Admin Task' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Operations Task' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Event' })).not.toBeInTheDocument();
    } finally {
      mockUser.is_head = true;
    }
  });

  describe('follows Settings > Activities (#1064)', () => {
    const withSettings = (types = {}, general = {}) => ({
      types: Object.fromEntries(Object.entries(DEFAULT_ACTIVITY_SETTINGS.types).map(([k, v]) => [k, { ...v, ...(types[k] ?? {}) }])),
      general: { ...DEFAULT_ACTIVITY_SETTINGS.general, ...general },
    });
    const useSettings = (settings) => vi.spyOn(activitySettingsService, 'get').mockResolvedValue(settings);
    afterEach(() => {
      vi.restoreAllMocks();
      setActivitySettings(DEFAULT_ACTIVITY_SETTINGS);
    });

    it('drops a type that is switched off and shows the new name of another', async () => {
      useSettings(withSettings({ EVENT: { active: false }, ADMIN_TASK: { name: 'Office Duty' } }));
      renderForm([]);
      await waitFor(() => expect(getActivitySettings().types.ADMIN_TASK.name).toBe('Office Duty'));
      await screen.findByText('Activity type');
      fireEvent.click(screen.getAllByRole('combobox')[0]);
      expect(await screen.findByRole('option', { name: 'Office Duty' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Event' })).not.toBeInTheDocument();
    });

    it('offers only the meeting types that are on', async () => {
      useSettings(withSettings({}, { meetingTypes: { ONSITE: true, ONLINE: false, HYBRID: false } }));
      renderForm([]);
      await waitFor(() => expect(getActivitySettings().general.meetingTypes.ONLINE).toBe(false));
      await screen.findByText('Meeting type');
      fireEvent.click(screen.getAllByRole('combobox')[1]);
      expect(await screen.findByRole('option', { name: 'Onsite' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Online' })).not.toBeInTheDocument();
    });

    it('lists times from the hours and step, and hides Guests when they are not allowed', async () => {
      useSettings(withSettings({}, { earliestStart: '08:00', latestEnd: '12:00', timeStep: 60, defaultStart: '09:00', defaultEnd: '10:00', guestsAllowed: false }));
      renderForm([], { date: '2031-03-10', start: '09:00', end: '10:00' });
      await waitFor(() => expect(getActivitySettings().general.guestsAllowed).toBe(false));
      await waitFor(() => expect(screen.queryByText('Guests (outside the company)')).not.toBeInTheDocument());
      fireEvent.click(screen.getAllByRole('combobox').find((c) => c.textContent.includes('09:00')));
      expect(await screen.findByRole('option', { name: '11:00' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: '09:15' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: '13:00' })).not.toBeInTheDocument();
    });
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

    it('says "To cannot be before From.", keeps the typed To, and does not blame the days list', async () => {
      renderForm([], { date: '2031-03-14' });
      await screen.findByText('Activity type');
      await pickType('Admin Task');
      setTo('2031-03-16');
      await screen.findByTestId('activity-day-rows');
      // The first day is removed, so a To before From used to leave no day at all: "Keep at least one day."
      fireEvent.click(screen.getByRole('button', { name: 'Remove Fri, Mar 14' }));
      setTo('2031-03-12');
      expect(await screen.findByTestId('problem-dateTo')).toHaveTextContent('To cannot be before From.');
      expect(screen.getByTestId('form-problem')).toHaveTextContent('To cannot be before From.');
      expect(document.querySelectorAll('input[type="date"]')[1]).toHaveValue('2031-03-12');
      expect(screen.queryByText('Keep at least one day.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
      // Fixed: the message goes and the typed value was never lost.
      setTo('2031-03-15');
      await waitFor(() => expect(screen.queryByTestId('problem-dateTo')).not.toBeInTheDocument());
    });
  });

  describe('opens on a time that can still be filed (#1086)', () => {
    const manila = (ymd, hhmm) => () => new Date(`${ymd}T${hhmm}:00+08:00`);
    const sendButton = () => screen.getByRole('button', { name: /Send request/ });
    // The Start and End boxes: the ones showing a time of day.
    const timeBoxes = () => screen.getAllByRole('combobox').map((c) => c.textContent.match(/^\s*(\d\d:\d\d)/)?.[1]).filter(Boolean);

    it('at 14:00 Manila: today, 14:00 to 15:00, and Send is on once the Purpose is written', async () => {
      renderForm([], {}, null, { clock: manila('2031-03-10', '14:00') });
      await screen.findByText('Activity type');
      expect(document.querySelector('input[type="date"]')).toHaveValue('2031-03-10');
      expect(timeBoxes()).toEqual(['14:00', '15:00']);
      // Nothing is wrong with the time: once the remembered Venue is in, the only thing missing is the Purpose, and the reason says so.
      await waitFor(() => expect(screen.getByTestId('form-problem')).toHaveTextContent('Write the purpose of the Activity.'));
      expect(screen.queryByTestId('problem-time')).not.toBeInTheDocument();
      fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: 'Planning' } });
      await waitFor(() => expect(sendButton()).toBeEnabled());
      expect(screen.queryByTestId('form-problem')).not.toBeInTheDocument();
    });

    it('at 14:20 Manila: the next slot, 14:30, keeping the length of the default Activity', async () => {
      renderForm([], {}, null, { clock: manila('2031-03-10', '14:20') });
      await screen.findByText('Activity type');
      expect(timeBoxes()).toEqual(['14:30', '15:30']);
    });

    it('when today is over: tomorrow at the default start', async () => {
      renderForm([], {}, null, { clock: manila('2031-03-10', '22:30') });
      await screen.findByText('Activity type');
      expect(document.querySelector('input[type="date"]')).toHaveValue('2031-03-11');
      expect(timeBoxes()).toEqual(['09:00', '10:00']);
      expect(screen.queryByTestId('problem-time')).not.toBeInTheDocument();
    });

    it('shows the reason under its own box and just above the buttons', async () => {
      renderForm([], {}, null, { clock: manila('2031-03-10', '14:00') });
      await screen.findByText('Activity type');
      expect(screen.getByTestId('problem-purpose')).toHaveTextContent('Write the purpose of the Activity.');
      // The first problem is the summary line; the Venue is still being remembered, so it comes first.
      await waitFor(() => expect(screen.getByTestId('form-problem')).toHaveTextContent('Write the purpose of the Activity.'));
      expect(screen.queryByTestId('problem-venue')).not.toBeInTheDocument();
    });
  });

  describe('closing a form with something in it (#1086)', () => {
    it('asks "Discard this Activity?" after something was typed, and closes only on Discard', async () => {
      const onClose = vi.fn();
      renderForm([], undefined, null, { onClose });
      await screen.findByText('Activity type');
      fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: 'Planning' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Discard this Activity?')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      // Keep editing: the question goes, the draft stays.
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      await waitFor(() => expect(screen.queryByText('Discard this Activity?')).not.toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('What is the Activity for?')).toHaveValue('Planning');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks after a pick too, not only after typing', async () => {
      const onClose = vi.fn();
      renderForm([], undefined, null, { onClose });
      await screen.findByText('Activity type');
      fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2031-03-12' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Discard this Activity?')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes at once when nothing was changed', async () => {
      const onClose = vi.fn();
      renderForm([], undefined, null, { onClose });
      await screen.findByText('Activity type');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Discard this Activity?')).not.toBeInTheDocument();
    });

    it('closes at once when what was typed is taken back out', async () => {
      const onClose = vi.fn();
      renderForm([], undefined, null, { onClose });
      await screen.findByText('Activity type');
      const purpose = screen.getByPlaceholderText('What is the Activity for?');
      fireEvent.change(purpose, { target: { value: 'Planning' } });
      fireEvent.change(purpose, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('editing a saved Activity (#1084)', () => {
    const saved = (over) => ({
      id: 'r1',
      status: 'APPROVED',
      activity_type: 'MEETING',
      meeting_type: 'ONSITE',
      meeting_link: null,
      venue_id: 'v1',
      facilitator_id: 'fac',
      participants: [],
      guests: [],
      guest_emails: [],
      purpose: 'Sales huddle',
      starts_at: at('2031-03-10', '09:00'),
      ends_at: at('2031-03-10', '10:00'),
      days: [{ starts_at: at('2031-03-10', '09:00'), ends_at: at('2031-03-10', '10:00') }],
      ...over,
    });
    const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
    const typePurpose = (text) => fireEvent.change(screen.getByPlaceholderText('What is the Activity for?'), { target: { value: text } });

    it('keeps "Save changes" off until something is different', async () => {
      renderForm([], {}, saved());
      await screen.findByText('Activity type');
      expect(saveButton()).toBeDisabled();
    });

    it('turns it on for a changed purpose, and off again when the change is put back', async () => {
      renderForm([], {}, saved());
      await screen.findByText('Activity type');
      typePurpose('Sales huddle, moved');
      expect(saveButton()).toBeEnabled();
      typePurpose('Sales huddle');
      expect(saveButton()).toBeDisabled();
    });

    it('turns it on for a changed end time', async () => {
      renderForm([], {}, saved());
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await user.click(screen.getAllByRole('combobox').find((c) => c.textContent.includes('10:00')));
      await user.click(await screen.findByRole('option', { name: '11:00' }));
      expect(saveButton()).toBeEnabled();
    });

    it('turns it on for an added Guest, but not for a Guest that is only typed', async () => {
      renderForm([], {}, saved());
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await user.type(screen.getByPlaceholderText('Name'), 'Mr. Visitor');
      expect(saveButton()).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(saveButton()).toBeEnabled();
    });

    it('does not hold back "Send again" on a returned Activity', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      employeeService.getAllEmployees.mockResolvedValue([{ id: 'fac', name: 'Fay Facilitator', isHead: true }]);
      meetingRequestService.listVenues.mockResolvedValue([{ id: 'v1', name: 'Conference Room' }]);
      meetingRequestService.lastPicks.mockResolvedValue(null);
      calendarService.fetchEntries.mockResolvedValue([]);
      render(
        <QueryClientProvider client={client}>
          <MeetingRequestDialog open onClose={() => {}} editing={saved({ status: 'RETURNED' })} resend clock={defaultClock} />
        </QueryClientProvider>,
      );
      await screen.findByText('Activity type');
      expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
    });
  });

  describe('Guests are a name plus an email (#1087)', () => {
    const addGuest = async (user, name, email = '') => {
      const nameBox = screen.getByPlaceholderText('Name');
      const emailBox = screen.getByPlaceholderText('Email (optional)');
      fireEvent.change(nameBox, { target: { value: name } });
      fireEvent.change(emailBox, { target: { value: email } });
      await user.click(screen.getByRole('button', { name: 'Add' }));
    };

    it('says "Already added." for the same name and email, and keeps one Guest', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await addGuest(user, 'Ana Cruz', 'ana@example.com');
      expect(screen.queryByTestId('guest-note')).not.toBeInTheDocument();
      await addGuest(user, 'Ana Cruz', 'ana@example.com');
      expect(screen.getByTestId('guest-note')).toHaveTextContent('Already added.');
      expect(screen.getAllByRole('button', { name: 'Remove Ana Cruz' })).toHaveLength(1);
    });

    it('adds the same name with another email, and the same name with no email', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await addGuest(user, 'Ana Cruz', 'ana@example.com');
      await addGuest(user, 'Ana Cruz', 'ana@other.example');
      await addGuest(user, 'Ana Cruz');
      expect(screen.queryByTestId('guest-note')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Remove Ana Cruz' })).toHaveLength(3);
      expect(screen.getByText('Ana Cruz <ana@other.example>')).toBeInTheDocument();
    });

    it('takes away only the Guest that was clicked, and clears the message when the person types on', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await addGuest(user, 'Ana Cruz', 'ana@example.com');
      await addGuest(user, 'Ana Cruz', 'ana@other.example');
      await user.click(screen.getAllByRole('button', { name: 'Remove Ana Cruz' })[0]);
      expect(screen.queryByText('Ana Cruz <ana@example.com>')).not.toBeInTheDocument();
      expect(screen.getByText('Ana Cruz <ana@other.example>')).toBeInTheDocument();
      await addGuest(user, 'Ana Cruz', 'ana@other.example');
      expect(screen.getByTestId('guest-note')).toBeInTheDocument();
      await user.type(screen.getByPlaceholderText('Name'), ' Jr');
      expect(screen.queryByTestId('guest-note')).not.toBeInTheDocument();
    });
  });

  describe('purpose, meeting link and date limits (#1087)', () => {
    const purposeBox = () => screen.getByPlaceholderText('What is the Activity for?');

    it('counts the purpose, and stops the send at 501 characters with a message', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      expect(screen.getByTestId('purpose-counter')).toHaveTextContent('0 / 500');
      fireEvent.change(purposeBox(), { target: { value: 'a'.repeat(500) } });
      expect(screen.getByTestId('purpose-counter')).toHaveTextContent('500 / 500');
      expect(screen.getByRole('button', { name: /Send request/ })).toBeEnabled();
      expect(screen.queryByTestId('problem-purpose')).not.toBeInTheDocument();
      fireEvent.change(purposeBox(), { target: { value: 'a'.repeat(501) } });
      expect(screen.getByTestId('purpose-counter')).toHaveTextContent('501 / 500');
      expect(screen.getByTestId('problem-purpose')).toHaveTextContent('The purpose can be at most 500 characters.');
      expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
    });

    it('says under the link box that it must be a web link, and stops the send for anything else', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      const user = userEvent.setup();
      await user.click(screen.getAllByRole('combobox')[1]);
      await user.click(await screen.findByRole('option', { name: 'Online' }));
      const link = await screen.findByPlaceholderText(/Paste the link/);
      expect(screen.getByTestId('link-hint')).toHaveTextContent('The link must start with http:// or https://');
      fireEvent.change(purposeBox(), { target: { value: 'Planning' } });
      for (const bad of ['javascript:alert(1)', 'not a url']) {
        fireEvent.change(link, { target: { value: bad } });
        expect(screen.getByTestId('problem-link')).toHaveTextContent('The meeting link must start with http:// or https://.');
        expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
      }
      fireEvent.change(link, { target: { value: 'https://meet.google.com/x' } });
      expect(screen.queryByTestId('problem-link')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send request/ })).toBeEnabled();
    });

    it('stops the send for a date more than a year ahead, and offers no later date', async () => {
      renderForm([]);
      await screen.findByText('Activity type');
      fireEvent.change(purposeBox(), { target: { value: 'Planning' } });
      const date = document.querySelector('input[type="date"]');
      expect(date).toHaveAttribute('max', '2032-01-01');
      fireEvent.change(date, { target: { value: '2032-02-01' } });
      expect(screen.getByTestId('problem-date')).toHaveTextContent('The date can be at most one year ahead.');
      expect(screen.getByRole('button', { name: /Send request/ })).toBeDisabled();
      fireEvent.change(date, { target: { value: '2032-01-01' } });
      expect(screen.queryByTestId('problem-date')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send request/ })).toBeEnabled();
    });
  });
});

describe('Group Task Activity form (#1250)', () => {
  const groupTask = { id: 'gt1', title: 'Trade show stand', memberIds: ['fac'], startDate: '2031-03-20', dueDate: '2031-03-22' };

  it('opens on the Start Date to the Due Date, type fixed, title read-only, no Venue', async () => {
    meetingRequestService.fileRequest.mockResolvedValue({});
    renderForm([], { groupTask });
    expect(await screen.findByTestId('group-task-title')).toHaveTextContent('Trade show stand');
    expect(screen.getByTestId('activity-type-fixed')).toHaveTextContent('Group Task');
    expect(screen.queryByText('Venue')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('What is the Activity for?')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await waitFor(() => expect(meetingRequestService.fileRequest).toHaveBeenCalled());
    const sent = meetingRequestService.fileRequest.mock.calls.at(-1)[0];
    expect(sent).toMatchObject({ activityType: 'GROUP_TASK', groupTaskId: 'gt1', purpose: 'Trade show stand' });
    expect(sent.days.map((d) => d.startsAt.slice(0, 10))).toEqual(['2031-03-20', '2031-03-21', '2031-03-22']);
  });

  it('starts today when the Start Date has passed', async () => {
    meetingRequestService.fileRequest.mockResolvedValue({});
    renderForm([], { groupTask: { ...groupTask, startDate: '2030-12-01', dueDate: '2031-01-02' } });
    await screen.findByTestId('group-task-title');
    await userEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await waitFor(() => expect(meetingRequestService.fileRequest).toHaveBeenCalled());
    expect(meetingRequestService.fileRequest.mock.calls.at(-1)[0].days[0].startsAt.slice(0, 10)).toBe('2031-01-01');
  });

  it('the ordinary form does not list Group Task', async () => {
    renderForm([]);
    await screen.findByText('Activity type');
    expect(screen.queryByText('Group Task')).not.toBeInTheDocument();
  });
});
