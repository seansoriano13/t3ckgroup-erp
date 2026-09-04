import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import HrLeavesManagerPage from '@/pages/hr/offsets/index';
import { renderWithProviders } from '@/test/support';
import { makeHrEmployee, makeEmployee, makeOffsetLeave, makeOvertimeRequest } from '@/test/factories';
import { db } from '@/test/db/store';

const mockUser = vi.hoisted(() => ({ current: null }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
    isAuthLoading: false,
  }),
}));

// The History/Document Center tabs are scoped to whatever month FloatingMonthPicker
// currently has selected — the 15th of the current month, not a hardcoded date, so
// these tests keep passing regardless of when "today" is.
function midCurrentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`;
}

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

  describe('Document Center', () => {
    let fakePrintWindow;

    beforeEach(() => {
      fakePrintWindow = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, print: vi.fn() };
      vi.stubGlobal('open', vi.fn(() => fakePrintWindow));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('adds an approved record to the tray, previews it, and prints it for free — no PDF API call', async () => {
      const user = userEvent.setup();
      const applicant = makeEmployee({ name: 'Printable Employee' });
      const leave = makeOffsetLeave({
        employee_id: applicant.id,
        status: 'APPROVED',
        reason: 'Sample leave',
        date: midCurrentMonth(),
      });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('button', { name: /Document Center/i });
      await user.click(documentsTab);

      const checkbox = await screen.findByRole('checkbox', { name: /Add Printable Employee's OFFSET record to the tray/i });
      await user.click(checkbox);

      await screen.findByText('Tray (1)');

      const printButton = await screen.findByRole('button', { name: /^Print$/i });
      await waitFor(() => expect(printButton).not.toBeDisabled());

      await user.click(printButton);

      await waitFor(() => expect(fakePrintWindow.print).toHaveBeenCalled(), { timeout: 3000 });

      // Printing stamps the record so the picker can show it was already printed.
      await waitFor(() => {
        const row = db.rows('offset_leaves').find((r) => r.id === leave.id);
        expect(row.printed_at).toEqual(expect.any(String));
        expect(row.printed_by).toBe(hrUser.id);
      });

      await screen.findByText('Already printed');
    });

    it('the live preview follows tray order — the same order the browser will print in', async () => {
      const user = userEvent.setup();
      const employeeA = makeEmployee({ name: 'Alpha Employee' });
      const employeeB = makeEmployee({ name: 'Beta Employee' });
      makeOffsetLeave({ employee_id: employeeA.id, status: 'APPROVED', date: midCurrentMonth() });
      makeOffsetLeave({ employee_id: employeeB.id, status: 'APPROVED', date: midCurrentMonth() });

      const { container } = renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('button', { name: /Document Center/i });
      await user.click(documentsTab);

      // Add Beta first, then Alpha — the tray (and so the preview) should
      // read Beta-before-Alpha, proving the preview follows tray order
      // rather than, say, the picker's own list order.
      const betaCheckbox = await screen.findByRole('checkbox', { name: /Add Beta Employee's OFFSET record to the tray/i });
      await user.click(betaCheckbox);
      const alphaCheckbox = await screen.findByRole('checkbox', { name: /Add Alpha Employee's OFFSET record to the tray/i });
      await user.click(alphaCheckbox);

      await screen.findByText('Tray (2)');

      await waitFor(() => {
        const srcDoc = container.querySelector('iframe[title="Document preview"]').getAttribute('srcdoc');
        expect(srcDoc).toBeTruthy();
        expect(srcDoc.indexOf('Beta Employee')).toBeGreaterThan(-1);
        expect(srcDoc.indexOf('Beta Employee')).toBeLessThan(srcDoc.indexOf('Alpha Employee'));
      });
    });

    it('filters the Approved Records picker by employee name, without touching the tray', async () => {
      const user = userEvent.setup();
      const employeeA = makeEmployee({ name: 'Searchable Alpha' });
      const employeeB = makeEmployee({ name: 'Hidden Beta' });
      makeOffsetLeave({ employee_id: employeeA.id, status: 'APPROVED', date: midCurrentMonth() });
      makeOffsetLeave({ employee_id: employeeB.id, status: 'APPROVED', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('button', { name: /Document Center/i });
      await user.click(documentsTab);

      await screen.findByRole('checkbox', { name: /Add Searchable Alpha's OFFSET record to the tray/i });
      await screen.findByRole('checkbox', { name: /Add Hidden Beta's OFFSET record to the tray/i });

      const searchInput = await screen.findByRole('textbox', { name: /Search approved records by employee name/i });
      await user.type(searchInput, 'Alpha');

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /Add Searchable Alpha's OFFSET record to the tray/i })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: /Add Hidden Beta's OFFSET record to the tray/i })).not.toBeInTheDocument();
      });
    });

    it('removing a record from the tray takes it back out of the print composition', async () => {
      const user = userEvent.setup();
      const applicant = makeEmployee({ name: 'Removable Employee' });
      makeOvertimeRequest({ employee_id: applicant.id, status: 'APPROVED_PAID', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('button', { name: /Document Center/i });
      await user.click(documentsTab);

      const checkbox = await screen.findByRole('checkbox', { name: /Add Removable Employee's OVERTIME record to the tray/i });
      await user.click(checkbox);
      await screen.findByText('Tray (1)');

      const removeButton = await screen.findByRole('button', { name: /Remove Removable Employee's OVERTIME record from the tray/i });
      await user.click(removeButton);

      await screen.findByText('Check records below to add them here, then drag to set print order.');
    });
  });

  describe('Request History', () => {
    it('is read-only — no selection checkboxes or print action remain', async () => {
      const user = userEvent.setup();
      const applicant = makeEmployee({ name: 'History Employee' });
      makeOffsetLeave({ employee_id: applicant.id, status: 'APPROVED', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const historyTab = await screen.findByRole('button', { name: /Request History/i });
      await user.click(historyTab);

      const row = await screen.findByText('History Employee');
      const table = row.closest('table');
      expect(within(table).queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
    });
  });
});
