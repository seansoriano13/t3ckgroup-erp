/**
 * The Calendar page's header: one Month | Gantt switch, My Activities in a side
 * panel, and full screen (hides the side menu, the title and the day panel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import CalendarPage from '@/pages/calendar';
import { stubRoomyScreen } from '@/test/roomyScreen';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { useCalendarFullScreenOn, leaveCalendarFullScreen } from '@/lib/calendarFullScreen';

vi.mock('@/components/ProtectedRoute', () => ({ default: ({ children }) => children }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/services/calendarService', () => ({
  calendarService: { fetchEntries: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/meetingRequestService', async (importOriginal) => ({
  ...(await importOriginal()),
  meetingRequestService: { listVenues: vi.fn().mockResolvedValue([]), listMine: vi.fn() },
}));
vi.mock('@/components/calendar/MeetingRequestDialog', () => ({ default: () => null }));
vi.mock('@/components/calendar/MeetingActions.jsx', () => ({
  default: ({ request }) => (
    <div>
      <button type="button">Edit {request.id}</button>
      <button type="button">Cancel {request.id}</button>
    </div>
  ),
}));

// Stands in for the app frame: the side menu is there unless full screen is on.
function Frame() {
  const fullScreen = useCalendarFullScreenOn();
  return (
    <div>
      {!fullScreen && <nav aria-label="Side menu">menu</nav>}
      <CalendarPage />
    </div>
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/calendar?date=2031-03-10']}>
        <Frame />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Calendar page header', () => {
  beforeEach(() => {
    stubRoomyScreen();
    window.localStorage.clear();
    calendarService.fetchEntries.mockResolvedValue([]);
    meetingRequestService.listMine.mockResolvedValue([
      { id: 'r1', purpose: 'Quarterly planning', status: 'PENDING', facilitator: { name: 'Lead' }, starts_at: '2031-03-12T01:00:00+00:00', ends_at: '2031-03-12T02:00:00+00:00' },
    ]);
  });
  afterEach(() => leaveCalendarFullScreen());

  it('has one Month | Gantt switch and no Calendar | My Activities tabs', async () => {
    renderPage();
    await screen.findByTestId('calendar-month');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gantt', pressed: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gantt' }));
    expect(await screen.findByTestId('calendar-gantt')).toBeInTheDocument();
  });

  it('opens My Activities in a side panel with Edit and Cancel', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'My Activities' }));
    expect(await screen.findByText('Quarterly planning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit r1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel r1' })).toBeInTheDocument();
  });

  it('full screen hides the side menu, the title and the day panel; Esc and the button bring them back', async () => {
    renderPage();
    await screen.findByTestId('calendar-month');
    expect(screen.getByRole('navigation', { name: 'Side menu' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Calendar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.queryByRole('navigation', { name: 'Side menu' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Calendar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^[A-Z][a-z]{2} · [A-Z][a-z]{2} \d+/ })).toBeNull();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Side menu' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Calendar/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(screen.getByRole('navigation', { name: 'Side menu' })).toBeInTheDocument();
  });
});
