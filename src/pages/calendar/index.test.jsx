import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import CalendarPage from './index';
import { calendarService } from '@/services/calendarService';

vi.mock('@/components/ProtectedRoute', () => ({ default: ({ children }) => children }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/services/calendarService', () => ({
  calendarService: { fetchEntries: vi.fn().mockResolvedValue([]) },
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

describe('Calendar page views', () => {
  beforeEach(() => calendarService.fetchEntries.mockResolvedValue([]));

  it('restores the view and date from the URL, with an agenda for phones', async () => {
    renderAt('/calendar?view=week&date=2026-10-21');
    expect(await screen.findByTestId('time-grid')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('Oct 19 to Oct 25, 2026');
    expect(screen.getByTestId('calendar-agenda')).toBeInTheDocument();
  });

  it('keeps the selected date across views and steps previous, next and today', async () => {
    renderAt('/calendar?view=month&date=2026-10-21');
    await screen.findByTestId('calendar-month');
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(screen.getByTestId('where')).toHaveTextContent('view=day');
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-10-21');
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-10-22');
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-10-22');
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-10-15');
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('where')).toHaveTextContent('date=2026-11-15');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('where').textContent).not.toContain('2026-11-15');
  });
});
