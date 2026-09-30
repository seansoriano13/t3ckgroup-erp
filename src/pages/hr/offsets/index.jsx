import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { offsetService } from '../../../services/offsetService';
import { silService } from '../../../services/silService';
import { employeeService } from '../../../services/employeeService';
import { companyService, matchesCompanyFilter } from '../../../services/companyService';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import ProtectedRoute from '../../../components/ProtectedRoute.jsx';
import { Button } from '@/components/ui/button';
import PageHeader from '../../../components/ui/PageHeader';
import NotionLeaveCalendar from '../../../components/hr/NotionLeaveCalendar';
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
import LeavesSidebar from './_components/LeavesSidebar';
import PendingList from './_components/PendingList';
import RecordView from './_components/RecordView';
import HistoryView from './_components/HistoryView';
import TeamTimeline from './_components/TeamTimeline';
import BalancesTable from './_components/BalancesTable';
import DocumentCenterTab from './_components/DocumentCenterTab';
import { recordKey } from './_components/leaveDisplay';

export default function HrLeavesManagerPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('calendar'); // see LEAVE_VIEWS
  // The request open as its own page, by key, plus the list it was opened
  // from so the Decision card's arrows can step through that list.
  const [openRecord, setOpenRecord] = useState(null); // { key, list }
  
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

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companyService.getCompanies(),
  });

  // Manage FloatingMonthPicker visibility
  useEffect(() => {
    if (activeTab === 'pending') {
      window.dispatchEvent(new Event('FLOATING_PICKER_HIDE'));
    } else {
      window.dispatchEvent(new Event('FLOATING_PICKER_SHOW'));
    }
    return () => {
      window.dispatchEvent(new Event('FLOATING_PICKER_SHOW'));
    };
  }, [activeTab]);

  const { data, isLoading: loading } = useQuery({
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

    let actionLabel = actionType === 'reject' ? 'Reject' : 'Approve';

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
        toast.success(`Request ${actionLabel.toLowerCase()}d successfully.`);
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

  const filteredPending = useMemo(() => {
    return pendingLeaves.filter(req => {
      if (leaveTypeFilter !== 'ALL' && req.type !== leaveTypeFilter) return false;
      if (searchQuery) {
        const empName = (req.employee?.name || '').toLowerCase();
        if (!empName.includes(searchQuery.toLowerCase())) return false;
      }

      if (pendingPeriodFilter !== 'ALL') {
        if (!isRequestInPendingPeriod(req.date, pendingPeriodFilter)) return false;
      }
      if (!matchesCompanyFilter(req.company_id, companyFilter)) return false;
      return true;
    });
  }, [pendingLeaves, leaveTypeFilter, searchQuery, pendingPeriodFilter, companyFilter]);

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

  const filteredProcessed = useMemo(() => {
    return processedLeaves.filter(req => {
      if (leaveTypeFilter !== 'ALL' && req.type !== leaveTypeFilter) return false;
      if (searchQuery) {
        const empName = (req.employee?.name || '').toLowerCase();
        if (!empName.includes(searchQuery.toLowerCase())) return false;
      }
      if (!matchesCompanyFilter(req.company_id, companyFilter)) return false;
      return true;
    });
  }, [processedLeaves, leaveTypeFilter, searchQuery, companyFilter]);

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

  const filters = {
    searchQuery, setSearchQuery,
    leaveTypeFilter, setLeaveTypeFilter,
    companyFilter, setCompanyFilter,
    pendingPeriodFilter, setPendingPeriodFilter,
  };

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

        <FloatingMonthPicker
          selectedRange={dateRange}
          onChange={setDateRange}
        />

        <ApplyLeaveModal
          isOpen={isApplyModalOpen}
          onClose={() => setIsApplyModalOpen(false)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
          showEmployeeSelector
        />
    </>
  );

  const header = (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="Leaves Manager"
          description="Review leave applications, approve overtime, and manage employee balances."
        />
        <Button
          type="button"
          onClick={() => setIsApplyModalOpen(true)}
          className="flex-none h-auto bg-foreground text-background font-black px-5 py-2.5 rounded-xl shadow-sm border border-border/10 hover:bg-foreground/90 uppercase tracking-widest text-xs"
        >
          <Plus size={16} />
          File for Employee
        </Button>
      </div>
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

  const openFrom = (record, list) => setOpenRecord({ key: recordKey(record), list });
  const changeView = (view) => {
    setOpenRecord(null);
    setActiveTab(view);
  };

  // Resolve the open request from live data, so it reflects a decision the
  // moment the queries refetch (a pending request reappears as decided).
  const openList = openRecord?.list.map((r) => [...pendingLeaves, ...processedLeaves].find((x) => recordKey(x) === recordKey(r)) || r);
  const record = openRecord && [...pendingLeaves, ...processedLeaves].find((r) => recordKey(r) === openRecord.key);

  let view;
  if (record) {
    view = (
      <RecordView
        record={record}
        list={openList}
        onStep={(r) => openFrom(r, openRecord.list)}
        onBack={() => setOpenRecord(null)}
        handleAction={handleAction}
        handleUndo={handleUndo}
        setPreviewToken={setPreviewToken}
        availableHoursFor={availableHoursFor}
      />
    );
  } else if (activeTab === 'pending') {
    view = (
      <PendingList
        rows={filteredPending}
        total={pendingLeaves.length}
        loading={loading}
        availableHoursFor={availableHoursFor}
        filters={filters}
        companies={companies}
        onOpen={openFrom}
      />
    );
  } else if (activeTab === 'calendar') {
    view = <NotionLeaveCalendar approvedLeaves={approvedLeaves} targetDate={dateRange.startDate} canViewAllReasons />;
  } else if (activeTab === 'timeline') {
    view = <TeamTimeline approvedLeaves={approvedLeaves} pendingLeaves={pendingLeaves} monthStart={dateRange.startDate} />;
  } else if (activeTab === 'history') {
    view = <HistoryView rows={filteredProcessed} loading={loading} filters={filters} companies={companies} onOpen={openFrom} />;
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
        processedLeaves={processedLeaves}
        filters={filters}
        companies={companies}
        onReview={(r, list) => { setActiveTab('pending'); openFrom(r, list); }}
      />
    );
  }

  // Full-bleed page (see _app.jsx): the view sidebar sits flush on the panel
  // edge and the content column carries the normal page padding itself.
  return (
    <ProtectedRoute requireHr={true} allowLeaveManagers={true}>
      {overlays}
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <LeavesSidebar
          activeTab={activeTab}
          onChange={changeView}
          pendingLeaves={pendingLeaves}
          processedLeaves={processedLeaves}
          approvedLeaves={approvedLeaves}
          filters={filters}
          companies={companies}
        />
        <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-10 sm:px-10">
            {header}
            <div key={record ? `record-${openRecord.key}` : activeTab} className="animate-in fade-in duration-200">
              {view}
            </div>
          </div>
        </div>
      </div>
      {previewDialog}
    </ProtectedRoute>
  );
}
