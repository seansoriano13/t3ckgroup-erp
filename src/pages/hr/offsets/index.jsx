import React, { useState, useMemo, useCallback, useEffect } from 'react';
import QueryError from "@/components/ui/QueryError";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { offsetService } from '../../../services/offsetService';
import { silService } from '../../../services/silService';
import { employeeService } from '../../../services/employeeService';
import { companyService, matchesCompanyFilter } from '../../../services/companyService';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Building2, CalendarDays, Plus } from 'lucide-react';
import ProtectedRoute from '../../../components/ProtectedRoute.jsx';
import { Button } from '@/components/ui/button';
import PageShell from '../../../components/ui/PageShell';
import TabGroup from '../../../components/ui/TabGroup';
import FilterBar from '../../../components/ui/FilterBar';
import { FilterSelect } from '../../../components/ui/FilterDropdown';
import Dot from '../../../components/ui/Dot';
import ApproveOvertimeModal from '../../../components/offsets/ApproveOvertimeModal';
import ApproveOffsetModal from '../../../components/offsets/ApproveOffsetModal';
import ApproveUndertimeModal from '../../../components/offsets/ApproveUndertimeModal';
import ApplyLeaveModal from '../../../components/offsets/ApplyLeaveModal';
import FloatingMonthPicker from '../../../components/FloatingMonthPicker';
import { confirmActionToast } from '../../../components/ui/CustomToast';
import { getMonthBoundaries } from '../../../utils/dateUtils';
import { isRequestInPendingPeriod } from '../../../utils/time';
import { groupLeaveRows } from '../../../utils/leaveGroups';
import { computeAvailableHours } from '../../../services/leaveRules';
import VerifiedRecordPreview from '../../../components/verify/VerifiedRecordPreview';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import WhoIsOut from './_components/WhoIsOut';
import PendingList from './_components/PendingList';
import LeaveSheet from './_components/LeaveSheet';
import ProfileSheet from './_components/ProfileSheet';
import HistoryView from './_components/HistoryView';
import CalendarTab from './_components/CalendarTab';
import BalancesTable from './_components/BalancesTable';
import DocumentCenterTab from './_components/DocumentCenterTab';
import { LEAVE_TYPES, LEAVE_VIEWS, TYPE_META } from './_components/leaveDisplay';
import { useLeaveSheet } from './_components/useLeaveSheet';

export default function HrLeavesManagerPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('calendar'); // see LEAVE_VIEWS

  // Date Range State (for FloatingMonthPicker)
  const currentDate = new Date();
  const currentMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const initialBoundaries = getMonthBoundaries(currentMonthStr);

  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: initialBoundaries.startDate,
    endDate: initialBoundaries.endDate,
  });

  const [overtimeApproval, setOvertimeApproval] = useState(null); // { request, status }
  const [offsetApproval, setOffsetApproval] = useState(null); // { request }
  const [undertimeApproval, setUndertimeApproval] = useState(null); // { request, status }
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [previewToken, setPreviewToken] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('ALL'); // 'ALL', 'OVERTIME', 'OFFSET', 'SIL'
  const [pendingPeriodFilter, setPendingPeriodFilter] = useState('ALL'); // 'ALL', 'THIS_MONTH', 'NEXT_MONTH', 'OVERDUE'
  const [companyFilter, setCompanyFilter] = useState('ALL'); // company id, 'ALL', or 'NONE'
  const [pendingAsc, setPendingAsc] = useState(true); // Pending sorts soonest-first

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  const { data, isLoading: loading, isError, refetch } = useQuery({
    queryKey: ['hrLeaves', dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      // 1. Fetch Balances
      const allEmps = await employeeService.getAllEmployees();
      const undertimeTotals = await offsetService.getMonthlyUndertimeTotals();
      const empData = allEmps.map(emp => ({
        id: emp.id,
        name: emp.name,
        department: emp.department,
        avatar_path: emp.avatarPath,
        offset_hours_balance: emp.offset_hours_balance,
        sil_hours_balance: emp.sil_hours_balance,
        // Derived, read-only — never a stored balance (issue #148).
        undertime_this_month: undertimeTotals[emp.id] || 0,
        company: emp.company,
      })).sort((a, b) => a.name.localeCompare(b.name));

      // 2. Fetch Requests
      const [
        allOt,
        allOffset,
        allSil,
        allUndertime,
        pendingOt,
        pendingOffset,
        pendingSil,
        pendingUndertime
      ] = await Promise.all([
        offsetService.getAllOvertimeRequests(dateRange.startDate, dateRange.endDate),
        offsetService.getAllOffsetLeaves(dateRange.startDate, dateRange.endDate),
        silService.getAllSilLeaves(dateRange.startDate, dateRange.endDate),
        offsetService.getAllUndertimeRequests(dateRange.startDate, dateRange.endDate),
        offsetService.getAllPendingOvertimeRequests(),
        offsetService.getAllPendingOffsetLeaves(),
        silService.getAllPendingSilLeaves(),
        offsetService.getAllPendingUndertimeRequests()
      ]);

      // Tag types for period-scoped requests
      const taggedOt = allOt.map(l => ({ ...l, type: 'OVERTIME' }));
      const taggedOffset = allOffset.map(l => ({ ...l, type: 'OFFSET' }));
      const taggedSil = allSil.map(l => ({ ...l, type: 'SIL' }));
      const taggedUndertime = allUndertime.map(l => ({ ...l, type: 'UNDERTIME' }));
      const combined = [...taggedOt, ...taggedOffset, ...taggedSil, ...taggedUndertime];

      // Tag types for dateless pending requests
      const taggedPendingOt = pendingOt.map(l => ({ ...l, type: 'OVERTIME' }));
      const taggedPendingOffset = pendingOffset.map(l => ({ ...l, type: 'OFFSET' }));
      const taggedPendingSil = pendingSil.map(l => ({ ...l, type: 'SIL' }));
      const taggedPendingUndertime = pendingUndertime.map(l => ({ ...l, type: 'UNDERTIME' }));
      // A range writes one row per day (see ticket #63), so rows sharing a
      // leave_group_id are collapsed into one entry before the queue is built —
      // otherwise a 3-day leave would show as three separate pending requests.
      const pendingCombined = groupLeaveRows([...taggedPendingOt, ...taggedPendingOffset, ...taggedPendingSil, ...taggedPendingUndertime])
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Processed (from period-scoped) — grouped the same way as pending.
      const processed = groupLeaveRows(
        combined.filter(req => req.status !== 'PENDING' && req.status !== 'CANCELLED')
      ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      // Approved feeds the calendar, which plots one card per day — left
      // ungrouped so every day in a range still gets its own cell.
      const approved = combined.filter(req => ['APPROVED', 'APPROVED_OFFSET', 'APPROVED_PAID'].includes(req.status) && (req.type === 'OFFSET' || req.type === 'SIL'));

      return {
        employeeBalances: empData,
        pendingLeaves: pendingCombined,
        processedLeaves: processed,
        approvedLeaves: approved,
      };
    }
  });

  const {
    pendingLeaves = [],
    processedLeaves = [],
    approvedLeaves = [],
    employeeBalances = [],
  } = data || {};

  const handleAction = useCallback((request, actionType) => {
    // actionType: 'approve', 'approve_paid' (for OT), 'reject'
    const isOT = request.type === 'OVERTIME';
    const isOffset = request.type === 'OFFSET';
    const isSIL = request.type === 'SIL';
    const isUndertime = request.type === 'UNDERTIME';

    // Approving overtime lets HR edit the hours actually rendered before
    // they're credited, so it opens a modal rather than a plain confirm.
    if (isOT && actionType !== 'reject') {
      const status = actionType === 'approve' ? 'APPROVED_OFFSET' : 'APPROVED_PAID';
      setOvertimeApproval({ request, status });
      return;
    }

    // Undertime has no paid/offset split, but still lets HR edit the hours
    // actually charged before they're recorded — same modal pattern.
    if (isUndertime) {
      const status = actionType === 'reject' ? 'REJECTED' : 'APPROVED';
      setUndertimeApproval({ request, status });
      return;
    }

    // Offset leave too: HR can approve fewer hours than requested (#328).
    if (isOffset && actionType !== 'reject') {
      setOffsetApproval({ request });
      return;
    }

    let actionLabel = actionType === 'reject' ? 'Decline' : 'Approve';
    const pastTense = actionType === 'reject' ? 'declined' : 'approved';

    const rangeNote = request.dayCount > 1 ? ` (${request.dayCount} days, ${request.startDate} to ${request.endDate})` : '';
    let title = `${actionLabel} Request`;
    let msg = `Are you sure you want to ${actionLabel.toLowerCase()} this ${request.type.toLowerCase()} request for ${request.hours} hours${rangeNote}?`;

    confirmActionToast(title, msg, actionLabel, actionType === 'reject' ? 'destructive' : 'default', async () => {
      try {
        if (isOT) {
          await offsetService.handleOvertimeDecision({ requestId: request.id, status: 'REJECTED', hrId: user?.id });
        } else if (isOffset) {
          await offsetService.handleOffsetLeaveDecision({ groupId: request.leave_group_id, status: 'REJECTED', hrId: user?.id });
        } else if (isSIL) {
          const status = actionType === 'approve' ? 'APPROVED' : 'REJECTED';
          await silService.handleSilLeaveDecision({ groupId: request.leave_group_id, status, hrId: user?.id });
        }
        toast.success(`Request ${pastTense} successfully.`);
        queryClient.invalidateQueries({ queryKey: ['hrLeaves'] });
      } catch (err) {
        toast.error(err.message || `Failed to ${actionLabel.toLowerCase()} request.`);
      }
    });
  }, [user?.id, queryClient]);

  const handleUndo = useCallback((request) => {
    const isOT = request.type === 'OVERTIME';
    const isOffset = request.type === 'OFFSET';
    const isSIL = request.type === 'SIL';
    const isUndertime = request.type === 'UNDERTIME';

    confirmActionToast(
      'Undo Decision',
      `Are you sure you want to undo this decision? The request will return to PENDING status${isUndertime ? '' : ' and balances will be restored'}.`,
      'Undo Decision',
      'destructive',
      async () => {
        try {
          if (isOT) {
            await offsetService.undoOvertimeDecision({ requestId: request.id, hrId: user?.id });
          } else if (isOffset) {
            await offsetService.undoOffsetLeaveDecision({ groupId: request.leave_group_id, hrId: user?.id });
          } else if (isSIL) {
            await silService.undoSilLeaveDecision({ groupId: request.leave_group_id, hrId: user?.id });
          } else if (isUndertime) {
            await offsetService.undoUndertimeDecision({ requestId: request.id, hrId: user?.id });
          }
          toast.success('Decision undone successfully.');
          queryClient.invalidateQueries({ queryKey: ['hrLeaves'] });
        } catch (err) {
          toast.error(err.message || 'Failed to undo decision.');
        }
      }
    );
  }, [user?.id, queryClient]);

  // Search, company and (for Pending) period narrow a list first; the type
  // pills then slice what is left, so their counts always add up to "All".
  const matchesSearch = useCallback(
    (req) => !searchQuery || (req.employee?.name || '').toLowerCase().includes(searchQuery.toLowerCase()),
    [searchQuery],
  );
  const byType = useCallback(
    (list) => (leaveTypeFilter === 'ALL' ? list : list.filter(req => req.type === leaveTypeFilter)),
    [leaveTypeFilter],
  );

  const pendingScoped = useMemo(() => pendingLeaves.filter(req => {
    if (!matchesSearch(req)) return false;
    if (pendingPeriodFilter !== 'ALL' && !isRequestInPendingPeriod(req.date, pendingPeriodFilter)) return false;
    return matchesCompanyFilter(req.company_id, companyFilter);
  }), [pendingLeaves, matchesSearch, pendingPeriodFilter, companyFilter]);
  const filteredPending = useMemo(() => byType(pendingScoped), [byType, pendingScoped]);

  // Every employee's total hours already committed to pending applications,
  // by leave type — computed from the full pending queue (not the filtered
  // view) so "available" stays accurate regardless of which filters are
  // active (issue #106).
  const pendingHoursByEmployee = useMemo(() => {
    const totals = new Map();
    pendingLeaves.forEach(req => {
      if (req.type !== 'OFFSET' && req.type !== 'SIL') return;
      const key = `${req.employee_id}_${req.type}`;
      totals.set(key, (totals.get(key) || 0) + parseFloat(req.hours || 0));
    });
    return totals;
  }, [pendingLeaves]);

  const availableHoursFor = useCallback((req) => {
    if (req.type !== 'OFFSET' && req.type !== 'SIL') return null;
    const balance = req.type === 'OFFSET' ? req.employee?.offset_hours_balance : req.employee?.sil_hours_balance;
    const pending = pendingHoursByEmployee.get(`${req.employee_id}_${req.type}`) || 0;
    return computeAvailableHours(balance, pending);
  }, [pendingHoursByEmployee]);

  const processedScoped = useMemo(
    () => processedLeaves.filter(req => matchesSearch(req) && matchesCompanyFilter(req.company_id, companyFilter)),
    [processedLeaves, matchesSearch, companyFilter],
  );
  const filteredProcessed = useMemo(() => byType(processedScoped), [byType, processedScoped]);

  const filteredBalances = useMemo(() => {
    let list = employeeBalances;
    if (searchQuery) list = list.filter(emp => emp.name.toLowerCase().includes(searchQuery.toLowerCase()));
    list = list.filter(emp => matchesCompanyFilter(emp.company?.id, companyFilter));
    return list;
  }, [employeeBalances, searchQuery, companyFilter]);

  // The Document Center's picker is scoped to approved records only — same
  // restriction Request History enforced when it still had a print action.
  const approvedForDocuments = useMemo(
    () => filteredProcessed.filter(r => r.status.startsWith('APPROVED')),
    [filteredProcessed]
  );

  const overlays = (
    <>
        <ApproveOffsetModal
          isOpen={!!offsetApproval}
          onClose={() => setOffsetApproval(null)}
          request={offsetApproval?.request}
          hrId={user?.id}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
        />

        <ApproveOvertimeModal
          isOpen={!!overtimeApproval}
          onClose={() => setOvertimeApproval(null)}
          request={overtimeApproval?.request}
          status={overtimeApproval?.status}
          hrId={user?.id}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
        />

        <ApproveUndertimeModal
          isOpen={!!undertimeApproval}
          onClose={() => setUndertimeApproval(null)}
          request={undertimeApproval?.request}
          status={undertimeApproval?.status}
          hrId={user?.id}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
        />

        <ApplyLeaveModal
          isOpen={isApplyModalOpen}
          onClose={() => setIsApplyModalOpen(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
          showEmployeeSelector
        />
    </>
  );

  // Pending is every open request whatever its date, and balances are as of
  // today, so only the period views take the month.
  const usesPeriod = activeTab !== 'pending' && activeTab !== 'balances';
  const action = (
    <>
      {usesPeriod && <FloatingMonthPicker inline selectedRange={dateRange} onChange={setDateRange} />}
      <WhoIsOut approvedLeaves={approvedLeaves} />
      <Button type="button" onClick={() => setIsApplyModalOpen(true)}>
        <Plus size={16} />
        File for Employee
      </Button>
    </>
  );

  const previewDialog = (
      <Dialog open={!!previewToken} onOpenChange={(open) => !open && setPreviewToken(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-transparent border-0 shadow-none">
          <VisuallyHidden>
            <DialogTitle>Verified Record Preview</DialogTitle>
          </VisuallyHidden>
          {previewToken && (
            <VerifiedRecordPreview token={previewToken} standalone={false} />
          )}
        </DialogContent>
      </Dialog>
  );

  const requests = useMemo(() => [...pendingLeaves, ...processedLeaves], [pendingLeaves, processedLeaves]);
  const sheet = useLeaveSheet({
    requests,
    employeeBalances,
    pendingView: filteredPending,
    historyView: filteredProcessed,
  });
  const openFrom = (request, list) => sheet.openRequest(request, list);

  // A shared link lands on the view its record belongs to (the first time one opens).
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!landed && sheet.view) {
      setLanded(true);
      if (sheet.view !== activeTab) setActiveTab(sheet.view);
    }
  }, [landed, sheet.view, activeTab]);

  // Otherwise open on the work: Pending when anything waits (else Calendar), once data is in.
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (!picked && !landed && !sheet.view && data) {
      setPicked(true);
      if (pendingLeaves.length > 0) setActiveTab('pending');
    }
  }, [picked, landed, sheet.view, data, pendingLeaves.length]);
  // Switching view closes the open slide-over, so `?record=` never outlives its list.
  const changeView = (view) => {
    setPicked(true);
    sheet.close();
    setActiveTab(view);
  };

  // A modal (hours, preview) opens over a hidden slide-over instead of a second
  // focus trap; the slide-over comes back if the modal is cancelled.
  const modalOpen = !!(offsetApproval || overtimeApproval || undertimeApproval || previewToken);

  let view;
  if (activeTab === 'pending') {
    view = (
      <PendingList
        rows={filteredPending}
        total={pendingLeaves.length}
        loading={loading}
        availableHoursFor={availableHoursFor}
        asc={pendingAsc}
        onOpen={openFrom}
      />
    );
  } else if (activeTab === 'calendar') {
    view = <CalendarTab approvedLeaves={approvedLeaves} pendingLeaves={pendingLeaves} monthStart={dateRange.startDate} />;
  } else if (activeTab === 'history') {
    view = <HistoryView rows={filteredProcessed} loading={loading} onOpen={openFrom} />;
  } else if (activeTab === 'documents') {
    view = (
      <DocumentCenterTab
        approvedRecords={approvedForDocuments}
        allLoadedRecords={[...pendingLeaves, ...processedLeaves]}
        hrId={user?.id}
        onPrinted={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
      />
    );
  } else {
    view = (
      <BalancesTable
        employees={filteredBalances}
        pendingLeaves={pendingLeaves}
        onOpenPerson={sheet.openPerson}
      />
    );
  }
  if (isError) {
    view = <QueryError title="Leave requests could not be loaded." onRetry={refetch} />;
  }

  // Level 1 switches the view; level 2 slices the list by type. Search and
  // company narrow the lists (and the level-2 counts), Pending adds a period
  // and a sort. Calendar (Month | People) and Documents bring their own controls.
  const isList = activeTab === 'pending' || activeTab === 'history';
  const typeScope = activeTab === 'history' ? processedScoped : pendingScoped;
  const typeCounts = LEAVE_TYPES.reduce((m, t) => ({ ...m, [t]: typeScope.filter(r => r.type === t).length }), {});
  const filtersActive = !!searchQuery || companyFilter !== 'ALL' || (activeTab === 'pending' && pendingPeriodFilter !== 'ALL') || (isList && leaveTypeFilter !== 'ALL');
  const clearFilters = () => {
    setSearchQuery('');
    setCompanyFilter('ALL');
    setPendingPeriodFilter('ALL');
    setLeaveTypeFilter('ALL');
  };
  const chipClass = 'h-9 w-auto gap-2 px-2.5';

  const typeTabs = isList && (
    <TabGroup
      variant="pill"
      size="sm"
      activeTab={leaveTypeFilter}
      onChange={setLeaveTypeFilter}
      tabs={[
        { value: 'ALL', label: 'All', badge: typeScope.length },
        ...LEAVE_TYPES.map((t) => ({
          value: t,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Dot color={TYPE_META[t].dot} />
              {TYPE_META[t].label}
            </span>
          ),
          badge: typeCounts[t],
        })),
      ]}
    />
  );

  const hasToolbar = (activeTab === 'pending' || activeTab === 'history' || activeTab === 'balances');
  const toolbar = hasToolbar && (
    <>
      {typeTabs}
      <FilterBar
        search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Search employees' }}
        chips={
          <>
            <FilterSelect
              icon={Building2}
              label="Company"
              value={companyFilter}
              onChange={setCompanyFilter}
              options={[
                { value: 'ALL', label: 'All companies' },
                { value: 'NONE', label: 'No company set' },
                ...companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className={chipClass}
              wrapperClassName="w-auto shrink-0"
            />
            {activeTab === 'pending' && (
              <FilterSelect
                icon={CalendarDays}
                label="Date"
                value={pendingPeriodFilter}
                onChange={setPendingPeriodFilter}
                options={[
                  { value: 'ALL', label: 'Any date' },
                  { value: 'THIS_MONTH', label: 'This month' },
                  { value: 'NEXT_MONTH', label: 'Next month' },
                  { value: 'OVERDUE', label: 'Overdue' },
                ]}
                className={chipClass}
                wrapperClassName="w-auto shrink-0"
              />
            )}
          </>
        }
        hasActiveFilters={filtersActive}
        onClearAll={clearFilters}
        actions={activeTab === 'pending' && (
          <Button type="button" variant="outline" size="lg" onClick={() => setPendingAsc((v) => !v)} className="gap-2 sm:ml-auto">
            {pendingAsc ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            {pendingAsc ? 'Soonest first' : 'Latest first'}
          </Button>
        )}
      />
    </>
  );

  return (
    <ProtectedRoute requireHr={true} allowLeaveManagers={true}>
      {overlays}
      <PageShell
        title="Time Off & Overtime"
        description="Review leave applications, approve overtime, and manage employee balances."
        action={action}
        tabs={
          <TabGroup
            variant="underline"
            size="md"
            activeTab={activeTab}
            onChange={changeView}
            tabs={LEAVE_VIEWS.map((v) => (v.value === 'pending' ? { ...v, badge: pendingLeaves.length } : v))}
          />
        }
        toolbar={toolbar}
      >
        <div key={activeTab} className="animate-in fade-in duration-200">
          {view}
        </div>
      </PageShell>

      <LeaveSheet
        record={modalOpen ? null : sheet.request}
        crumb={sheet.crumb}
        index={sheet.stepIndex}
        total={sheet.stepList.length}
        onStep={sheet.stepBy}
        onClose={sheet.closeRequest}
        actions={{ decide: handleAction, undo: handleUndo, preview: setPreviewToken }}
        availableHoursFor={availableHoursFor}
      />
      <ProfileSheet
        person={modalOpen ? null : sheet.person}
        held={(type) => (sheet.person ? pendingHoursByEmployee.get(`${sheet.person.id}_${type}`) || 0 : 0)}
        pending={sheet.person ? pendingLeaves.filter((r) => r.employee_id === sheet.person.id) : []}
        decided={sheet.person ? processedLeaves.filter((r) => r.employee_id === sheet.person.id) : []}
        onClose={sheet.close}
        onReview={(request, list) => sheet.openRequest(request, list, { fromPersonId: sheet.person.id })}
      />
      {previewDialog}
    </ProtectedRoute>
  );
}
