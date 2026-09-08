import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeLeavesPage from '@/pages/offsets/index';
import { renderWithProviders } from '@/test/support';
import { makeEmployee, makeOvertimeRequest } from '@/test/factories';
import { offsetService } from '@/services/offsetService';
import { silService } from '@/services/silService';

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

vi.mock('@/components/ui/CustomToast', () => ({
  confirmDeleteToast: (_title, _description, onConfirm) => onConfirm(),
  confirmActionToast: (_title, _description, _label, _variant, onConfirm) => onConfirm(),
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

  it('withdraws pending overtime using offsetService instead of silService', async () => {
    const user = userEvent.setup();
    const today = new Date().toISOString().slice(0, 10);
    const ot = makeOvertimeRequest({
      employee_id: employee.id,
      status: 'PENDING',
      hours: 4,
      date: today,
    });

    const withdrawOtSpy = vi.spyOn(offsetService, 'withdrawOvertimeRequest');
    const cancelSilSpy = vi.spyOn(silService, 'cancelMySilLeave');

    renderWithProviders(<EmployeeLeavesPage />);

    // Switch to My Overtime tab
    const otTab = await screen.findByRole('button', { name: /My Overtime/i });
    await user.click(otTab);

    // Look for withdraw button in the pending section
    const [withdrawBtn] = await screen.findAllByTitle('Withdraw Request');
    await user.click(withdrawBtn);

    await waitFor(() => {
      expect(withdrawOtSpy).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: ot.id, employeeId: employee.id }),
      );
    });

    expect(cancelSilSpy).not.toHaveBeenCalled();
  });
});
