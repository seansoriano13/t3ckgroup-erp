/**
 * The Calendar's two layouts: the month with a day rail and the Gantt. The
 * layout, date and Gantt range live in the URL; the layout is also remembered
 * in this browser. Rooms can be booked from the rail and the Gantt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import CalendarPage from '@/pages/calendar';
import { stubRoomyScreen } from '@/test/roomyScreen';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';

vi.mock('@/components/ProtectedRoute', () => ({ default: ({ children }) => children }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/services/calendarService', () => ({
  calendarService: { fetchEntries: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/meetingRequestService', async (importOriginal) => ({
  ...(await importOriginal()),
  meetingRequestService: { listVenues: vi.fn() },
}));
vi.mock('@/components/calendar/MeetingRequestDialog', () => ({
  default: ({ open, initial }) => (open ? <div data-testid="request-form">{JSON.stringify(initial)}</div> : null),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.search}</div>;
}

function renderAt(url) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <CalendarPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The day panel is a side panel at every width: open it from the toolbar's day button.
const openDayPanel = async () => fireEvent.click(await screen.findByRole('button', { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ }));

describe('Calendar layouts', () => {
  beforeEach(() => {
    stubRoomyScreen();
    window.localStorage.clear();
    calendarService.fetchEntries.mockResolvedValue([]);
    meetingRequestService.listVenues.mockResolvedValue([
      { id: 'v1', name: 'Conference Room' },
      { id: 'v2', name: 'Admin Office' },
    ]);
  });

  it('restores the Gantt and its range from the URL', async () => {
    renderAt('/calendar?layout=gantt&date=2026-10-21&weeks=4');
    expect(await screen.findByTestId('calendar-gantt')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('Oct 19 to Nov 15, 2026');
    expect(calendarService.fetchEntries).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-19', to: '2026-11-15' }));
  });

  it('opens on the month and remembers the layout picked', async () => {
    renderAt('/calendar?date=2026-10-21');
    await screen.findByTestId('calendar-month');
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('October 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Gantt' }));
    expect(await screen.findByTestId('calendar-gantt')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('layout=gantt');
    expect(window.localStorage.getItem('calendar.layout')).toBe('gantt');
  });

  it('keeps the selected date across layouts and steps previous, next and today', async () => {
    renderAt('/calendar?date=2026-10-23');
    await screen.findByTestId('calendar-month');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-23');
    fireEvent.click(screen.getByRole('button', { name: 'Gantt' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-23');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-16');
    fireEvent.click(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByTestId('where')).toHaveTextContent('weeks=4');
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByTestId('where').textContent).not.toContain('weeks=');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const where = screen.getByTestId('where').textContent;
    // Today either drops the date or sets it to today's date — never leaves the picked one.
    if (where.includes('date=')) expect(where).toContain(`date=${today}`);
  });

  it('drops the old ?view= param instead of breaking', async () => {
    renderAt('/calendar?view=week&date=2026-10-21');
    await screen.findByTestId('calendar-month');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('where').textContent).not.toContain('view=');
  });

  it('shows each room in the day rail; a free spot opens the pre-filled form', async () => {
    renderAt('/calendar?date=2031-03-10');
    await openDayPanel();
    expect(await screen.findByTestId('venue-strip-Conference Room')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request Admin Office on 2031-03-10' }));
    expect(JSON.parse(screen.getByTestId('request-form').textContent)).toEqual({
      venueId: 'v2',
      date: '2031-03-10',
      start: '08:00',
      end: '09:00',
    });
  });

  it('books a free room day from the Gantt', async () => {
    renderAt('/calendar?layout=gantt&date=2031-03-10');
    expect(await screen.findByTestId('venue-row-Conference Room')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book Conference Room on March 12' }));
    expect(JSON.parse(screen.getByTestId('request-form').textContent)).toEqual({ venueId: 'v1', date: '2031-03-12' });
  });
});

describe('Calendar Activity types', () => {
  const activity = (id, type, title, venue) => ({
    kind: 'MEETING',
    id,
    group_id: id,
    manila_date: '2031-03-10',
    starts_at: '2031-03-10T01:00:00+00:00',
    ends_at: '2031-03-10T02:00:00+00:00',
    status: 'APPROVED',
    venue,
    title,
    employee: { id: 'e1', name: 'Sample Person', department: 'Ops' },
    details: { activity_type: type, purpose: title, stage: 'APPROVED', participants: [], guests: [] },
  });

  beforeEach(() => {
    stubRoomyScreen();
    window.localStorage.clear();
    meetingRequestService.listVenues.mockResolvedValue([{ id: 'v1', name: 'Conference Room' }]);
    calendarService.fetchEntries.mockResolvedValue([
      activity('a1', 'MEETING', 'Weekly sync', 'Conference Room'),
      activity('a2', 'EVENT', 'Town hall', 'Conference Room'),
      activity('a3', 'ADMIN_TASK', 'Archive files', null),
      activity('a4', 'OPERATIONS_TASK', 'Inventory count', null),
      { kind: 'SIL', id: 's1', manila_date: '2031-03-10', status: 'APPROVED', employee: { name: 'Away Person' } },
    ]);
  });

  it('draws each type in its own colour', async () => {
    const { container } = renderAt('/calendar?date=2031-03-10');
    await screen.findByText('Weekly sync', { selector: '*' }).catch(() => null);
    await screen.findByRole('button', { name: /^Filters/ });
    for (const dot of ['bg-teal-9', 'bg-plum-9', 'bg-indigo-9', 'bg-orange-9']) {
      expect(container.querySelector(`.${dot}`)).not.toBeNull();
    }
  });

  it('filters by type, leaves Time Off alone, and shows everything again when cleared', async () => {
    renderAt('/calendar?date=2031-03-10');
    fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
    const eventChip = await screen.findByRole('button', { name: /^Event/ });
    expect(await screen.findAllByText(/Weekly sync/)).not.toHaveLength(0);
    fireEvent.click(eventChip);
    expect(screen.getByRole('button', { name: 'Remove filter Event' })).toBeInTheDocument();
    expect(screen.queryAllByText(/Weekly sync/)).toHaveLength(0);
    expect(screen.queryAllByText(/Archive files/)).toHaveLength(0);
    expect(screen.getAllByText(/Town hall/).length).toBeGreaterThan(0);
    await openDayPanel();
    expect(screen.getAllByText(/Away Person/).length).toBeGreaterThan(0);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('day-rail')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.getAllByText(/Weekly sync/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Archive files/).length).toBeGreaterThan(0);
  });

  it('counts only Activities with a Venue under Rooms', async () => {
    renderAt('/calendar?date=2031-03-10');
    await openDayPanel();
    await screen.findByTestId('venue-strip-Conference Room');
    const rooms = screen.getByRole('region', { name: 'Rooms' });
    expect(rooms).toHaveTextContent(/Rooms\s*2/);
  });
});
