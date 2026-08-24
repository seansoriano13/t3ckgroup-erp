import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeLeavesPage from '@/pages/offsets/index';
import { renderWithProviders } from '@/test/support';
import { makeEmployee } from '@/test/factories';

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
});
