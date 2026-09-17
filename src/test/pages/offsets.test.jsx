import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeLeavesPage from '@/pages/offsets/index';
import { renderWithProviders, setupUser } from '@/test/support';
import { within } from '@testing-library/react';
import { makeEmployee, makeOffsetLeave, makeOvertimeRequest, makeUndertimeRequest } from '@/test/factories';

// The page's history queries are bound to the currently displayed month
// (defaulting to "today"), while its pending queries are unbounded. A test
// asserting a *decided* request is visible needs a date inside that default
// window, so it uses today's date rather than a fixed one the page would
// filter out depending on when the suite runs.
const todayStr = new Date().toISOString().slice(0, 10);

const mockUser = vi.hoisted(() => ({ current: null }));

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
    renderWithProviders(<EmployeeLeavesPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/My\s*Requests/i);
    expect(screen.getByText(/Available Offset Hours/i)).toBeInTheDocument();
    expect(screen.getByText(/Available SIL Hours/i)).toBeInTheDocument();
  });

  it('shows every request type in one list, newest first', async () => {
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-05', created_at: '2026-03-05T00:00:00Z' });
    makeOvertimeRequest({ employee_id: employee.id, date: '2026-03-10', created_at: '2026-03-10T00:00:00Z' });
    makeUndertimeRequest({ employee_id: employee.id, date: '2026-03-08', created_at: '2026-03-08T00:00:00Z' });

    renderWithProviders(<EmployeeLeavesPage />);

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

    renderWithProviders(<EmployeeLeavesPage />);

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

    renderWithProviders(<EmployeeLeavesPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Offset')).toBeInTheDocument();
    expect(within(table).getByText('Overtime')).toBeInTheDocument();

    const filterSelect = screen.getByRole('combobox');
    await setupUser().selectOptions(filterSelect, 'OFFSET');

    expect(within(table).getByText('Offset')).toBeInTheDocument();
    expect(within(table).queryByText('Overtime')).not.toBeInTheDocument();
  });

  it('shows the withdraw action only for a pending request', async () => {
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-05', status: 'PENDING' });
    makeOvertimeRequest({ employee_id: employee.id, date: todayStr, status: 'APPROVED_OFFSET' });

    renderWithProviders(<EmployeeLeavesPage />);
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

    renderWithProviders(<EmployeeLeavesPage />);
    expect(await screen.findByText('Waiting on Jane Head')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been filed', async () => {
    renderWithProviders(<EmployeeLeavesPage />);
    expect(await screen.findByText('No requests found')).toBeInTheDocument();
  });

  it('still shows the shared approved-leave calendar tab', async () => {
    renderWithProviders(<EmployeeLeavesPage />);
    const calendarTab = await screen.findByRole('button', { name: /^Calendar$/i });
    await setupUser().click(calendarTab);
    expect(screen.queryByText('No requests found')).not.toBeInTheDocument();
  });
});
