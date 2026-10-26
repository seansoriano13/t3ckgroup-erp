/**
 * The Calendar's two layouts: the month with a day rail and the Gantt. The
 * layout, date and Gantt range live in the URL; the layout is also remembered
 * in this browser. Rooms can be booked from the rail and the Gantt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import CalendarPage from '@/pages/calendar';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';

vi.mock('@/components/ProtectedRoute', () => ({ default: ({ children }) => children }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/services/calendarService', () => ({
  calendarService: { fetchEntries: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/meetingRequestService', () => ({ meetingRequestService: { listVenues: vi.fn() } }));
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

describe('Calendar layouts', () => {
  beforeEach(() => {
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
    renderAt('/calendar?date=2026-10-21');
    await screen.findByTestId('calendar-month');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-21');
    fireEvent.click(screen.getByRole('button', { name: 'Gantt' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-21');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-14');
    fireEvent.click(screen.getByRole('button', { name: '4 weeks' }));
    expect(screen.getByTestId('where')).toHaveTextContent('weeks=4');
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByTestId('where').textContent).not.toContain('weeks=');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('where').textContent).not.toContain('2026-11-14');
  });

  it('drops the old ?view= param instead of breaking', async () => {
    renderAt('/calendar?view=week&date=2026-10-21');
    await screen.findByTestId('calendar-month');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('where').textContent).not.toContain('view=');
  });

  it('shows each room in the day rail; a free spot opens the pre-filled form', async () => {
    renderAt('/calendar?date=2031-03-10');
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
