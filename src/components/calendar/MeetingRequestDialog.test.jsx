import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MeetingRequestDialog from './MeetingRequestDialog';
import { employeeService } from '@/services/employeeService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { calendarService } from '@/services/calendarService';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', name: 'Me', is_head: true } }) }));
vi.mock('@/components/ui/ModalShell', () => ({ default: ({ children, actions }) => <div>{actions}{children}</div> }));
vi.mock('@/components/ui/PeoplePicker', () => ({ default: () => null }));
vi.mock('@/components/offsets/HeadSelectField', () => ({ default: () => null }));
vi.mock('@/services/calendarService', () => ({ calendarService: { fetchEntries: vi.fn() } }));
vi.mock('@/services/employeeService', () => ({ employeeService: { getAllEmployees: vi.fn() } }));
vi.mock('@/services/meetingRequestService', () => ({
  meetingRequestService: { listVenues: vi.fn(), lastPicks: vi.fn(), fileRequest: vi.fn() },
}));

const meeting = (over) => ({
  kind: 'MEETING',
  id: 'm1',
  starts_at: '2031-03-10T01:00:00.000Z', // 09:00 Manila
  ends_at: '2031-03-10T02:00:00.000Z', // 10:00 Manila
  status: 'APPROVED',
  venue: 'Conference Room',
  title: 'Sales huddle',
  employee: { id: 'dana', name: 'Dana Lim' },
  details: {},
  ...over,
});

function renderForm(entries) {
  employeeService.getAllEmployees.mockResolvedValue([
    { id: 'fac', name: 'Fay Facilitator', isHead: true },
    { id: 'me', name: 'Me', isHead: true },
  ]);
  meetingRequestService.listVenues.mockResolvedValue([
    { id: 'v1', name: 'Conference Room' },
    { id: 'v2', name: 'Admin Office' },
  ]);
  meetingRequestService.lastPicks.mockResolvedValue({ venueId: 'v1', facilitatorId: 'fac' });
  calendarService.fetchEntries.mockResolvedValue(entries);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MeetingRequestDialog open onClose={() => {}} initial={{ date: '2031-03-10', start: '09:00', end: '10:00' }} />
    </QueryClientProvider>,
  );
}

describe('Meeting Request form helpers', () => {
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
      { kind: 'SIL', id: 's1', status: 'APPROVED', employee: { id: 'fac', name: 'Fay Facilitator' }, details: {} },
      meeting({
        id: 'm3',
        venue: 'Admin Office',
        title: 'Other',
        details: { facilitator: { id: 'fac', name: 'Fay Facilitator' }, participants: [] },
      }),
    ]);
    const box = await screen.findByTestId('soft-warnings');
    expect(box).toHaveTextContent('Fay Facilitator is on approved SIL that day.');
    expect(box).toHaveTextContent('Fay Facilitator is in another meeting at Admin Office, 09:00 to 10:00.');
    fireEvent.change(screen.getByPlaceholderText('What is the meeting for?'), { target: { value: 'Planning' } });
    expect(screen.getByRole('button', { name: /Send request/ })).toBeEnabled();
  });
});
