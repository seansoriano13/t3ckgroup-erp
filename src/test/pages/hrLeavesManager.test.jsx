import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import HrLeavesManagerPage from '@/pages/hr/offsets/index';
import { renderWithProviders } from '@/test/support';
import { makeHrEmployee, makeEmployee, makeOffsetLeave } from '@/test/factories';

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

describe('HrLeavesManagerPage', () => {
  let hrUser;

  beforeEach(() => {
    hrUser = makeHrEmployee({ name: 'HR Admin' });
    mockUser.current = hrUser;
  });

  it('shows a request dated in a future month in the Pending tab', async () => {
    const user = userEvent.setup();
    const applicant = makeEmployee({ name: 'Future Requester' });

    // Seed a pending request for next month
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    makeOffsetLeave({
      employee_id: applicant.id,
      date: nextMonth.toISOString().split('T')[0],
      status: 'PENDING',
      reason: 'Future trip',
    });

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    // Wait for the Pending Requests tab to be available
    const pendingTab = await screen.findByRole('button', { name: /Pending Requests/i });
    await user.click(pendingTab);

    // Verify the future request is visible in the pending list
    await waitFor(() => {
      expect(screen.getByText('Future Requester')).toBeInTheDocument();
      expect(screen.getByText('Future trip')).toBeInTheDocument();
    });
  });
});
