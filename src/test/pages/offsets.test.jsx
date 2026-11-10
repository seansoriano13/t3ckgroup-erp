import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import EmployeeLeavesPage from '@/pages/offsets/index';
import { renderWithProviders, setupUser } from '@/test/support';
import { manilaToday } from '@/lib/manilaDate.js';
import { within } from '@testing-library/react';
import { makeEmployee, makeOffsetLeave, makeOvertimeRequest, makeUndertimeRequest } from '@/test/factories';

// The page's history queries are bound to the currently displayed month
// (defaulting to "today"), while its pending queries are unbounded. A test
// asserting a *decided* request is visible needs a date inside that default
// window, so it uses today's date rather than a fixed one the page would
// filter out depending on when the suite runs.
const todayStr = new Date().toISOString().slice(0, 10);

const mockUser = vi.hoisted(() => ({ current: null }));
const mockCalendar = vi.hoisted(() => ({ entries: [] }));

vi.mock('@/services/calendarService', () => ({
  calendarService: { fetchEntries: vi.fn(async () => mockCalendar.entries) },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe('EmployeeLeavesPage ("My Requests")', () => {
  let employee;

  beforeEach(() => {
    employee = makeEmployee({
      name: 'John Doe',
      offset_hours_balance: 10,
      sil_hours_balance: 20,
    });
    mockUser.current = { id: employee.id, name: employee.name, offset_hours_balance: 10, sil_hours_balance: 20 };
  });

  it('renders the My Requests header and both balances', () => {
    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/My\s*Requests/i);
    expect(screen.getByText(/Offset balance/i)).toBeInTheDocument();
    expect(screen.getByText(/SIL balance/i)).toBeInTheDocument();
  });

  it('shows every request type in one list, newest first', async () => {
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-05', created_at: '2026-03-05T00:00:00Z' });
    makeOvertimeRequest({ employee_id: employee.id, date: '2026-03-10', created_at: '2026-03-10T00:00:00Z' });
    makeUndertimeRequest({ employee_id: employee.id, date: '2026-03-08', created_at: '2026-03-08T00:00:00Z' });

    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);

    const rows = await screen.findAllByRole('row');
    // header row + 3 request rows
    expect(rows).toHaveLength(4);

    const table = screen.getByRole('table');
    const badges = ['Offset', 'Overtime', 'Undertime'];
    for (const label of badges) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
  });

  it('groups a multi-day application into a single row', async () => {
    const groupId = 'test-multi-day-group';
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-12', hours: 8, leave_group_id: groupId });
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-13', hours: 8, leave_group_id: groupId });
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-14', hours: 8, leave_group_id: groupId });

    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);

    const totalHours = await screen.findByText('24 hrs');
    expect(totalHours).toBeInTheDocument();
    expect(screen.getByText(/Mar 12/)).toBeInTheDocument();
    expect(screen.getByText(/Mar 14/)).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();

    const withdrawButtons = screen.getAllByTitle('Withdraw Request');
    expect(withdrawButtons).toHaveLength(1);
  });

  it('filters the list by request type', async () => {
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-05' });
    makeOvertimeRequest({ employee_id: employee.id, date: '2026-03-10' });

    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Offset')).toBeInTheDocument();
    expect(within(table).getByText('Overtime')).toBeInTheDocument();

    const filterSelect = screen.getByRole('button', { name: /all types/i });
    const user = setupUser();
    await user.click(filterSelect);
    await user.click(await screen.findByRole('button', { name: 'Offset' }));

    expect(within(table).getByText('Offset')).toBeInTheDocument();
    expect(within(table).queryByText('Overtime')).not.toBeInTheDocument();
  });

  it('shows the withdraw action only for a pending request', async () => {
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-05', status: 'PENDING' });
    makeOvertimeRequest({ employee_id: employee.id, date: todayStr, status: 'APPROVED_OFFSET' });

    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    const table = await screen.findByRole('table');
    await within(table).findByText('Offset');
    await within(table).findByText('Overtime');

    expect(screen.getAllByTitle('Withdraw Request')).toHaveLength(1);
  });

  it('names the department head a request is waiting on', async () => {
    const head = makeEmployee({ name: 'Jane Head' });
    makeOffsetLeave({
      employee_id: employee.id,
      date: '2026-03-05',
      status: 'PENDING',
      head_id: head.id,
      head_status: 'PENDING',
    });

    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    expect(await screen.findByText('Waiting on Jane Head')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been filed', async () => {
    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    expect(await screen.findByText('No requests found')).toBeInTheDocument();
  });

  it('still shows the shared approved-leave calendar tab', async () => {
    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    const calendarTab = await screen.findByRole('tab', { name: /^Calendar$/i });
    await setupUser().click(calendarTab);
    expect(screen.queryByText('No requests found')).not.toBeInTheDocument();
  });

  it('shows the shared Calendar with the viewer\'s own reasons and no colleague\'s', async () => {
    const date = manilaToday();
    const row = (id, who, details) => ({
      kind: 'OFFSET', id, group_id: id, starts_at: `${date}T01:00:00Z`, ends_at: `${date}T09:00:00Z`,
      all_day: false, manila_date: date, employee: { id: who.id, name: who.name, department: 'SALES', avatar: null },
      status: 'APPROVED', hours: 8, venue: null, title: 'Offset', details,
    });
    mockCalendar.entries = [
      row('mine', { id: employee.id, name: 'John Doe' }, { reason: 'My dentist' }),
      row('theirs', { id: 'other', name: 'Ben Lim' }, {}),
    ];
    const user = setupUser();
    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);
    await user.click(await screen.findByRole('tab', { name: /^Calendar$/i }));

    await user.click(await screen.findByText(/John D\. · Offset/));
    expect(await screen.findByText('My dentist')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByText(/Ben L\. · Offset/));
    expect(await screen.findAllByText('Ben Lim')).not.toHaveLength(0);
    expect(screen.queryByText('Reason')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('sits on PageShell: File Time Off / Overtime in the header, underlined tabs', async () => {
    renderWithProviders(<MemoryRouter><EmployeeLeavesPage /></MemoryRouter>);

    const header = screen.getByRole('heading', { level: 1 }).closest('div').parentElement;
    expect(header).toContainElement(screen.getByRole('button', { name: /file time off/i }));

    const requestsTab = await screen.findByRole('tab', { name: /^Requests/ });
    expect(requestsTab).toHaveAttribute('aria-selected', 'true');
    expect(requestsTab.className).toContain('border-b-2');
  });
});
