import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import HrLeavesManagerPage from '@/pages/hr/offsets/index';
import { renderWithProviders, setupUser } from '@/test/support';
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
    const user = setupUser();
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

    const pendingTab = await screen.findByRole('tab', { name: /^Pending/i });
    await user.click(pendingTab);

    // The future request is in the pending list, and opens as its own page.
    const row = await screen.findByRole('button', { name: /Open Future Requester's Offset request/i });
    await user.click(row);
    expect(await screen.findByText('Future trip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
  });

  // Issue #106 (HR-03): HR used to see only the raw balance, so two
  // legitimate-looking pending requests together could exceed what the
  // employee actually has left — this is what tells HR before they approve.
  it('shows available hours (balance minus every pending request) alongside each pending application', async () => {
    const user = setupUser();
    const applicant = makeEmployee({ name: 'Stacked Requester', offset_hours_balance: 16 });

    makeOffsetLeave({
      employee_id: applicant.id,
      date: '2026-03-10',
      hours: 4,
      status: 'PENDING',
      reason: 'First request',
    });
    makeOffsetLeave({
      employee_id: applicant.id,
      date: '2026-03-11',
      hours: 4,
      status: 'PENDING',
      reason: 'Second request',
    });

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    const pendingTab = await screen.findByRole('tab', { name: /^Pending/i });
    await user.click(pendingTab);

    // Both requests together commit 8 of the 16 hrs, so each row should read
    // 8 hrs available — not the raw 16 hr balance.
    await waitFor(() => {
      expect(screen.getAllByText('8 hrs available')).toHaveLength(2);
    });
  });

  // The slide-over's footer makes Offset-vs-Paid a choice with one
  // Approve button; picking Paid must still route to the Paid OT approval.
  it('approves overtime as Paid when Paid overtime is picked in the slide-over', async () => {
    const user = setupUser();
    const applicant = makeEmployee({ name: 'Overtime Worker' });
    makeOvertimeRequest({ employee_id: applicant.id, status: 'PENDING', hours: 3, date: midCurrentMonth() });

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('tab', { name: /^Pending/i }));
    await user.click(await screen.findByRole('button', { name: /Open Overtime Worker's Overtime request/i }));

    await user.click(await screen.findByRole('radio', { name: /Paid overtime/i }));
    await user.click(screen.getByRole('button', { name: /Approve as Paid/i }));

    expect(await screen.findByText('Approve as Paid OT')).toBeInTheDocument();
  });

  it('hides deactivated employees from the Employee Balances register', async () => {
    const user = setupUser();
    makeEmployee({ name: 'Active Worker', is_deleted: false });
    makeEmployee({ name: 'Deactivated Worker', is_deleted: true });

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    const balancesTab = await screen.findByRole('tab', { name: /Employee Balances/i });
    await user.click(balancesTab);

    await waitFor(() => {
      expect(screen.getByText('Active Worker')).toBeInTheDocument();
      expect(screen.queryByText('Deactivated Worker')).not.toBeInTheDocument();
    });
  });

  it('opens on Pending when requests are waiting, else on Calendar', async () => {
    const applicant = makeEmployee({ name: 'Waiting Person' });
    makeOffsetLeave({ employee_id: applicant.id, date: midCurrentMonth(), status: 'PENDING', reason: 'Errand' });

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('tab', { name: /^Pending/i })).toHaveAttribute('aria-selected', 'true'));
  });

  it('folds the Timeline into the Calendar tab as a Month | People switch', async () => {
    const user = setupUser();

    renderWithProviders(
      <MemoryRouter>
        <HrLeavesManagerPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Timeline' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'People' }));
    expect(await screen.findByText(/with time off/)).toBeInTheDocument();
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
      const user = setupUser();
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

      const documentsTab = await screen.findByRole('tab', { name: /Document Center/i });
      await user.click(documentsTab);

      const checkbox = await screen.findByRole('checkbox', { name: /Add Printable Employee's OFFSET record to the tray/i });
      await user.click(checkbox);

      await screen.findByText('1 form queued');

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
      const user = setupUser();
      const employeeA = makeEmployee({ name: 'Alpha Employee' });
      const employeeB = makeEmployee({ name: 'Beta Employee' });
      makeOffsetLeave({ employee_id: employeeA.id, status: 'APPROVED', date: midCurrentMonth() });
      makeOffsetLeave({ employee_id: employeeB.id, status: 'APPROVED', date: midCurrentMonth() });

      const { container } = renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('tab', { name: /Document Center/i });
      await user.click(documentsTab);

      // Add Beta first, then Alpha — the tray (and so the preview) should
      // read Beta-before-Alpha, proving the preview follows tray order
      // rather than, say, the picker's own list order.
      const betaCheckbox = await screen.findByRole('checkbox', { name: /Add Beta Employee's OFFSET record to the tray/i });
      await user.click(betaCheckbox);
      const alphaCheckbox = await screen.findByRole('checkbox', { name: /Add Alpha Employee's OFFSET record to the tray/i });
      await user.click(alphaCheckbox);

      await screen.findByText('2 forms queued');

      await waitFor(() => {
        const srcDoc = container.querySelector('iframe[title="Document preview"]').getAttribute('srcdoc');
        expect(srcDoc).toBeTruthy();
        expect(srcDoc.indexOf('Beta Employee')).toBeGreaterThan(-1);
        expect(srcDoc.indexOf('Beta Employee')).toBeLessThan(srcDoc.indexOf('Alpha Employee'));
      });
    });

    it('filters the Approved Records picker by employee name, without touching the tray', async () => {
      const user = setupUser();
      const employeeA = makeEmployee({ name: 'Searchable Alpha' });
      const employeeB = makeEmployee({ name: 'Hidden Beta' });
      makeOffsetLeave({ employee_id: employeeA.id, status: 'APPROVED', date: midCurrentMonth() });
      makeOffsetLeave({ employee_id: employeeB.id, status: 'APPROVED', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('tab', { name: /Document Center/i });
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
      const user = setupUser();
      const applicant = makeEmployee({ name: 'Removable Employee' });
      makeOvertimeRequest({ employee_id: applicant.id, status: 'APPROVED_PAID', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const documentsTab = await screen.findByRole('tab', { name: /Document Center/i });
      await user.click(documentsTab);

      const checkbox = await screen.findByRole('checkbox', { name: /Add Removable Employee's OVERTIME record to the tray/i });
      await user.click(checkbox);
      await screen.findByText('1 form queued');

      const removeButton = await screen.findByRole('button', { name: /Remove Removable Employee's OVERTIME record from the tray/i });
      await user.click(removeButton);

      await screen.findByText('0 forms queued');
    });
  });

  describe('Request History', () => {
    it('is read-only — no selection checkboxes or print action remain', async () => {
      const user = setupUser();
      const applicant = makeEmployee({ name: 'History Employee' });
      makeOffsetLeave({ employee_id: applicant.id, status: 'APPROVED', date: midCurrentMonth() });

      renderWithProviders(
        <MemoryRouter>
          <HrLeavesManagerPage />
        </MemoryRouter>
      );

      const historyTab = await screen.findByRole('tab', { name: /Request History/i });
      await user.click(historyTab);

      await screen.findByRole('button', { name: /Open History Employee's Offset decision/i });
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
    });
  });

  // #443 — the page is built from the shared parts: StatusBadge, the shared
  // slide-over (with ?record=), and the standard header button.
  describe('shared page parts', () => {
    function CurrentSearch() {
      return <output data-testid="search">{useLocation().search}</output>;
    }

    function renderAt(entry = '/hr/offsets') {
      return renderWithProviders(
        <MemoryRouter initialEntries={[entry]}>
          <HrLeavesManagerPage />
          <CurrentSearch />
        </MemoryRouter>
      );
    }

    function seedPendingOffset(name = 'Sheet Requester') {
      const applicant = makeEmployee({ name, offset_hours_balance: 16 });
      const next = new Date();
      next.setMonth(next.getMonth() + 1, 15);
      const leave = makeOffsetLeave({
        employee_id: applicant.id,
        date: next.toISOString().split('T')[0],
        hours: 4,
        status: 'PENDING',
        reason: 'Sheet reason',
      });
      return { applicant, leave, key: `OFFSET-${leave.leave_group_id || leave.id}` };
    }

    it('files for an employee from the standard red header button', async () => {
      renderAt();
      const button = await screen.findByRole('button', { name: /File for Employee/i });
      expect(button.className).not.toMatch(/uppercase|bg-foreground/);
      expect(button.className).toMatch(/bg-primary/);
      expect(button.className).toMatch(/h-8/);
    });

    it('shows a status as a StatusBadge, not a dot pill', async () => {
      const user = setupUser();
      seedPendingOffset();
      renderAt();

      await user.click(await screen.findByRole('tab', { name: /^Pending/i }));
      const row = await screen.findByRole('button', { name: /Open Sheet Requester's Offset request/i });
      const badge = within(row).getByText('Pending');
      expect(badge.className).toMatch(/uppercase/);
      expect(badge.className).toMatch(/border/);
      expect(badge.querySelector('span')).toBeNull();
    });

    it('opens a pending review in the slide-over and keeps it in ?record=', async () => {
      const user = setupUser();
      const { key } = seedPendingOffset();
      renderAt();

      await user.click(await screen.findByRole('tab', { name: /^Pending/i }));
      await user.click(await screen.findByRole('button', { name: /Open Sheet Requester's Offset request/i }));

      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('Sheet reason')).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /^Approve/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /^Decline/i })).toBeInTheDocument();
      expect(screen.getByTestId('search')).toHaveTextContent(`record=${key}`);
    });

    it('reopens the slide-over from a shared ?record= link', async () => {
      const { key } = seedPendingOffset();
      renderAt(`/hr/offsets?record=${key}`);

      const sheet = await screen.findByRole('dialog');
      expect(await within(sheet).findByText('Sheet reason')).toBeInTheDocument();
    });

    it('routes Approve from the slide-over through the hours modal', async () => {
      const user = setupUser();
      const { key } = seedPendingOffset();
      renderAt(`/hr/offsets?record=${key}`);

      const sheet = await screen.findByRole('dialog');
      await user.click(await within(sheet).findByRole('button', { name: /^Approve/i }));

      expect(await screen.findByText('Approve Offset Leave')).toBeInTheDocument();
    });

    it('steps to the next request in the list with the arrows', async () => {
      const user = setupUser();
      seedPendingOffset('First Requester');
      seedPendingOffset('Second Requester');
      renderAt();

      await user.click(await screen.findByRole('tab', { name: /^Pending/i }));
      await user.click(await screen.findByRole('button', { name: /Open First Requester's Offset request/i }));

      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('1 / 2')).toBeInTheDocument();
      await user.click(within(sheet).getByRole('button', { name: /Next record/i }));
      expect(await within(sheet).findByText('2 / 2')).toBeInTheDocument();
      expect(within(sheet).getByRole('heading', { name: 'Second Requester' })).toBeInTheDocument();
    });

    it('opens an employee balance profile in the slide-over and reviews a request from it', async () => {
      const user = setupUser();
      seedPendingOffset('Profile Requester');
      renderAt();

      await user.click(await screen.findByRole('tab', { name: /Employee Balances/i }));
      await user.click(await screen.findByRole('button', { name: /Open Profile Requester's time off/i }));

      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('Waiting on HR')).toBeInTheDocument();
      expect(screen.getByTestId('search')).toHaveTextContent('record=');

      await user.click(within(sheet).getByRole('button', { name: /Review/i }));
      expect(await screen.findByText('Sheet reason')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Approve/i })).toBeInTheDocument();
    });

    it('closing a request opened from a profile returns to that profile', async () => {
      const user = setupUser();
      seedPendingOffset('Profile Requester');
      renderAt();

      await user.click(await screen.findByRole('tab', { name: /Employee Balances/i }));
      await user.click(await screen.findByRole('button', { name: /Open Profile Requester's time off/i }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Review/i }));

      const sheet = await screen.findByRole('dialog');
      await within(sheet).findByText('Sheet reason');
      // The crumb names where Close goes.
      await user.click(within(sheet).getByRole('button', { name: 'Profile Requester' }));

      expect(await screen.findByText('Waiting on HR')).toBeInTheDocument();
      expect(screen.getByTestId('search')).toHaveTextContent('record=person');
    });

    it('keeps the Paid choice when the hours modal is cancelled', async () => {
      const user = setupUser();
      const applicant = makeEmployee({ name: 'Choice Worker' });
      const ot = makeOvertimeRequest({ employee_id: applicant.id, status: 'PENDING', hours: 3, date: midCurrentMonth() });
      renderAt(`/hr/offsets?record=OVERTIME-${ot.leave_group_id || ot.id}`);

      await user.click(await screen.findByRole('radio', { name: /Paid overtime/i }));
      await user.click(screen.getByRole('button', { name: /Approve as Paid/i }));
      expect(await screen.findByText('Approve as Paid OT')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      const paid = await screen.findByRole('radio', { name: /Paid overtime/i });
      expect(paid).toHaveAttribute('aria-checked', 'true');
    });

    it('lands a shared pending link on the Pending view, crumb and all', async () => {
      const { key } = seedPendingOffset();
      renderAt(`/hr/offsets?record=${key}`);

      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByRole('button', { name: 'Pending' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Pending/i, hidden: true })).toHaveAttribute('aria-selected', 'true');
    });

    it('clears ?record= when the view changes, so the slide-over does not follow', async () => {
      const { key } = seedPendingOffset();
      renderAt(`/hr/offsets?record=${key}`);
      await screen.findByRole('dialog');

      // The open sheet covers the tabs, so switch the way a shortcut or
      // assistive tech would: straight on the tab.
      fireEvent.click(screen.getByRole('tab', { name: /Request History/i, hidden: true }));

      await waitFor(() => expect(screen.getByTestId('search')).not.toHaveTextContent('record='));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows the outcome, hours and decided date on a decided request, with Undo', async () => {
      const applicant = makeEmployee({ name: 'Decided Requester' });
      const leave = makeOffsetLeave({
        employee_id: applicant.id,
        status: 'APPROVED',
        hours: 4,
        reason: 'Decided reason',
        date: midCurrentMonth(),
        updated_at: new Date().toISOString(),
      });
      renderAt(`/hr/offsets?record=OFFSET-${leave.leave_group_id || leave.id}`);

      const sheet = await screen.findByRole('dialog');
      await within(sheet).findByText('Decided reason');
      expect(within(sheet).getByText('Outcome')).toBeInTheDocument();
      expect(within(sheet).getByText('Decided')).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: /Undo decision/i })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: 'Request History' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Request History/i, hidden: true })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
