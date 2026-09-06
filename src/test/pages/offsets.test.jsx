import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeLeavesPage from '@/pages/offsets/index';
import { renderWithProviders } from '@/test/support';
import userEvent from '@testing-library/user-event';
import { makeEmployee, makeOffsetLeave } from '@/test/factories';

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe('EmployeeLeavesPage', () => {
  let employee;

  beforeEach(() => {
    employee = makeEmployee({
      name: 'John Doe',
      offset_hours_balance: 10,
      sil_hours_balance: 20,
    });
    mockUser.current = { id: employee.id, name: employee.name, offset_hours_balance: 10, sil_hours_balance: 20 };
  });

  it('renders without crashing and displays header and balances', () => {
    renderWithProviders(<EmployeeLeavesPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Leaves &.*Overtime/i);
    expect(screen.getByText(/Available Offset Hours/i)).toBeInTheDocument();
    expect(screen.getByText(/Available SIL Hours/i)).toBeInTheDocument();
  });

  it('files a three-day leave and asserts one row in the employee pending list', async () => {
    const groupId = 'test-multi-day-group';
    
    // Create 3 offset leaves representing a single 3-day application
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-12', hours: 8, leave_group_id: groupId });
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-13', hours: 8, leave_group_id: groupId });
    makeOffsetLeave({ employee_id: employee.id, date: '2026-03-14', hours: 8, leave_group_id: groupId });

    renderWithProviders(<EmployeeLeavesPage />);

    // Switch to the 'leave' tab (My Leaves)
    const leavesTab = await screen.findByRole('button', { name: /My Leaves/i });
    
    // We expect the tab to show "(1)" since it's grouped! Wait, the tab name is computed based on leaveHistory length.
    // The test specifies pending list, let's just look at the pending section.
    
    await userEvent.click(leavesTab);
    
    // The pending leaves section has a header "Awaiting Decision"
    expect(await screen.findByText('Awaiting Decision')).toBeInTheDocument();
    
    // The row should display the total hours (24) and the date range
    const totalHours = await screen.findByText('24 hrs');
    expect(totalHours).toBeInTheDocument();
    
    expect(screen.getByText(/Mar 12/)).toBeInTheDocument();
    expect(screen.getByText(/Mar 14/)).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();

    // Verify there is only one withdraw button in the pending list for this group
    const withdrawButtons = screen.getAllByTitle('Withdraw Request');
    expect(withdrawButtons).toHaveLength(1);
  });
});
