import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { offsetService } from '../../../services/offsetService';
import { silService } from '../../../services/silService';
import { employeeService } from '../../../services/employeeService';
import { companyService, matchesCompanyFilter } from '../../../services/companyService';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { Clock, CheckCircle2, XCircle, Search, Filter, LayoutGrid, List, Plus } from 'lucide-react';
import ProtectedRoute from '../../../components/ProtectedRoute.jsx';
import { Button } from '@/components/ui/button';
import DocumentCenterTab from './_components/DocumentCenterTab';
import PageContainer from '../../../components/ui/PageContainer';
import PageHeader from '../../../components/ui/PageHeader';
import TabGroup from '../../../components/ui/TabGroup';
import Spinner from '@/components/ui/Spinner';
import NotionLeaveCalendar from '../../../components/hr/NotionLeaveCalendar';
import ApproveOvertimeModal from '../../../components/offsets/ApproveOvertimeModal';
import ApproveOffsetModal from '../../../components/offsets/ApproveOffsetModal';
import ApproveUndertimeModal from '../../../components/offsets/ApproveUndertimeModal';
import ApplyLeaveModal from '../../../components/offsets/ApplyLeaveModal';
import FloatingMonthPicker from '../../../components/FloatingMonthPicker';
import Avatar from '../../../components/Avatar';
import { confirmActionToast } from '../../../components/ui/CustomToast';
import { AttachmentList } from '../../../components/ui/Attachments';
import { getMonthBoundaries } from '../../../utils/dateUtils';
import { formatWindow, isRequestInPendingPeriod } from '../../../utils/time';
import { groupLeaveRows } from '../../../utils/leaveGroups';
import { computeAvailableHours } from '../../../services/leaveRules';
import VerifiedRecordPreview from '../../../components/verify/VerifiedRecordPreview';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Input } from "@/components/ui/input";

export default function HrLeavesManagerPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar', 'pending', 'documents', 'history', 'balances'
  
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
  const [balancesLayout, setBalancesLayout] = useState('table'); // 'grid' | 'table'
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

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED_OFFSET':
        return (
          <span className="bg-green-2 text-green-11 border border-green-6 px-2 py-1 rounded-md font-bold text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved (Offset)
          </span>
        );
      case 'APPROVED_PAID':
        return (
          <span className="bg-blue-2 text-blue-11 border border-blue-6 px-2 py-1 rounded-md font-bold text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved (Paid OT)
          </span>
        );
      case 'APPROVED':
        return (
          <span className="bg-green-2 text-green-11 border border-green-6 px-2 py-1 rounded-md font-bold text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="bg-red-2 text-red-11 border border-red-6 px-2 py-1 rounded-md font-bold text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <XCircle size={12} /> Rejected
          </span>
        );
      default:
        return <span className="text-xs text-muted-foreground">{status}</span>;
    }
  };

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

  // Group filtered pending by month
  const pendingByMonth = useMemo(() => {
    const groups = {};
    filteredPending.forEach(req => {
      const d = new Date(req.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!groups[key]) {
        groups[key] = {
          label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          requests: []
        };
      }
      groups[key].requests.push(req);
    });
    // Sort groups by key ascending
    return Object.keys(groups).sort().map(k => groups[k]);
  }, [filteredPending]);

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

  return (
    <ProtectedRoute requireHr={true} allowLeaveManagers={true}>
    <PageContainer className="pt-4 space-y-6 relative">

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

      <ApplyLeaveModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
        showEmployeeSelector
      />

      <div className="space-y-4">
        <TabGroup
          variant="pill"
          tabs={[
            { value: 'calendar', label: `Calendar` },
            { value: 'pending', label: `Pending Requests (${pendingLeaves.length})` },
            { value: 'documents', label: `Document Center` },
            { value: 'history', label: `Request History` },
            { value: 'balances', label: `Employee Balances` },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          size="md"
        />

        {/* Toolbar (Search & Filter) for list views */}
        {(activeTab === 'pending' || activeTab === 'documents' || activeTab === 'history' || activeTab === 'balances') && (
           <div className="flex flex-col sm:flex-row gap-3">
             <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  containerClassName="w-full" className="pl-9 pr-4"
                />
              </div>

              {(activeTab === 'pending' || activeTab === 'documents' || activeTab === 'history') && (
                <div className="flex items-center space-x-2 bg-card border border-border rounded-xl px-3 py-1.5">
                  <Filter size={14} className="text-muted-foreground" />
                  <select
                    value={leaveTypeFilter}
                    onChange={(e) => setLeaveTypeFilter(e.target.value)}
                    className="bg-transparent text-sm font-semibold outline-none cursor-pointer text-foreground"
                  >
                    <option value="ALL">All Types</option>
                    <option value="OVERTIME">Overtime</option>
                    <option value="OFFSET">Offset Leave</option>
                    <option value="SIL">SIL Leave</option>
                    <option value="UNDERTIME">Undertime</option>
                  </select>
                </div>
              )}
              
              {(activeTab === 'pending' || activeTab === 'documents' || activeTab === 'history' || activeTab === 'balances') && (
                <div className="flex items-center space-x-2 bg-card border border-border rounded-xl px-3 py-1.5">
                  <select
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="bg-transparent text-sm font-semibold outline-none cursor-pointer text-foreground"
                    title="Filter by company"
                  >
                    <option value="ALL">All companies</option>
                    <option value="NONE">No company set</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {activeTab === 'pending' && (
                <div className="flex items-center space-x-2 bg-card border border-border rounded-xl px-3 py-1.5">
                  <Clock size={14} className="text-muted-foreground" />
                  <select
                    value={pendingPeriodFilter}
                    onChange={(e) => setPendingPeriodFilter(e.target.value)}
                    className="bg-transparent text-sm font-semibold outline-none cursor-pointer text-foreground"
                  >
                    <option value="ALL">All time</option>
                    <option value="THIS_MONTH">This month</option>
                    <option value="NEXT_MONTH">Next month</option>
                    <option value="OVERDUE">Overdue</option>
                  </select>
                </div>
              )}
              
              {activeTab === 'balances' && (
                <div className="flex items-center bg-card border border-border rounded-xl p-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setBalancesLayout('table')}
                    className={`rounded-lg ${balancesLayout === 'table' ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    title="Table View"
                  >
                    <List size={16} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setBalancesLayout('grid')}
                    className={`rounded-lg ${balancesLayout === 'grid' ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    title="Grid View"
                  >
                    <LayoutGrid size={16} />
                  </Button>
                </div>
              )}
           </div>
        )}

        {activeTab === 'pending' && filteredPending.length < pendingLeaves.length && (
          <p className="text-xs font-semibold text-muted-foreground px-1">
            Showing {filteredPending.length} of {pendingLeaves.length} pending requests
          </p>
        )}

        {/* Content Tabs */}
        {activeTab === 'calendar' && (
          <div className="animate-in fade-in duration-300">
             <NotionLeaveCalendar
              approvedLeaves={approvedLeaves}
              targetDate={dateRange.startDate}
              canViewAllReasons
            />
          </div>
        )}

        {activeTab === 'pending' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
            {loading ? (
            <div className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
              <Spinner size="md" />
              <span className="text-sm font-medium">Loading pending requests...</span>
            </div>
            ) : filteredPending.length === 0 ? (
               <div className="p-12 flex flex-col items-center justify-center text-center bg-muted/20">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4 text-muted-foreground/50">
                  <Clock size={32} />
                </div>
                <h3 className="text-lg font-black text-foreground mb-1">No pending requests</h3>
                <p className="text-sm font-medium text-muted-foreground">All caught up!</p>
              </div>
            ) : (
               <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                      <th className="p-4">Employee</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Category</th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Hours</th>
                      <th className="p-4">Reason</th>
                      <th className="p-4">Files</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pendingByMonth.map(group => (
                      <React.Fragment key={group.label}>
                        <tr>
                          <td colSpan="8" className="bg-muted/30 px-4 py-2 text-xs font-bold text-foreground border-y border-border/50">
                            {group.label}
                          </td>
                        </tr>
                        {group.requests.map(req => (
                           <tr key={req.type + '-' + (req.leave_group_id || req.id)} className="hover:bg-muted/30 transition-colors">
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <Avatar name={req.employee?.name} src={req.employee?.avatar_path} size="sm" />
                                  <div>
                                    <p className="text-sm font-bold text-foreground">{req.employee?.name}</p>
                                    <p className="text-xs text-muted-foreground font-medium">{req.employee?.department}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-4">
                                <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${
                                  req.type === 'OVERTIME' ? 'bg-muted text-foreground border-border' :
                                  req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' :
                                  req.type === 'UNDERTIME' ? 'bg-amber-2 text-amber-11 border-amber-6' : 'bg-green-2 text-green-11 border-green-6'
                                }`}>
                                  {req.type}
                                </span>
                              </td>
                              <td className="p-4 text-xs font-semibold text-foreground">
                                {req.category?.label || '-'}
                              </td>
                              <td className="p-4 text-sm font-bold text-foreground">
                                {req.dayCount > 1 ? (
                                  <>
                                    {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' – '}
                                    {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    <span className="ml-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                      {req.dayCount} days
                                    </span>
                                  </>
                                ) : (
                                  new Date(req.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                                )}
                              </td>
                              <td className="p-4">
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-black text-sm text-foreground">
                                    {req.hours} hrs
                                  </span>
                                  {req.start_time && req.end_time && (
                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                      {formatWindow(req.start_time, req.end_time)}
                                    </span>
                                  )}
                                  {availableHoursFor(req) !== null && (
                                    <span className="text-[10px] font-bold text-muted-foreground" title="Balance minus every pending application for this employee">
                                      {availableHoursFor(req)} hrs available
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-4 text-xs font-semibold text-muted-foreground truncate max-w-[150px]" title={req.reason}>
                                 {req.reason || '-'}
                              </td>
                              <td className="p-4">
                                 {req.attachments?.length ? (
                                   <AttachmentList attachments={req.attachments} compact />
                                 ) : (
                                   <span className="text-xs text-muted-foreground/50">-</span>
                                 )}
                              </td>
                              <td className="p-4 text-right space-x-2">
                                 {req.type === 'OVERTIME' ? (
                                    <>
                                      <Button type="button" variant="outline" onClick={() => handleAction(req, 'approve')} className="h-auto px-3 py-1.5 bg-green-2 text-green-11 hover:bg-green-3 border-green-6 text-xs font-bold">
                                        Approve (Offset)
                                      </Button>
                                      <Button type="button" variant="outline" onClick={() => handleAction(req, 'approve_paid')} className="h-auto px-3 py-1.5 bg-blue-2 text-blue-11 hover:bg-blue-3 border-blue-6 text-xs font-bold">
                                        Approve (Paid)
                                      </Button>
                                    </>
                                 ) : (
                                    <Button type="button" variant="outline" onClick={() => handleAction(req, 'approve')} className="h-auto px-3 py-1.5 bg-green-2 text-green-11 hover:bg-green-3 border-green-6 text-xs font-bold">
                                        Approve
                                    </Button>
                                 )}
                                 <Button type="button" variant="outline" onClick={() => handleAction(req, 'reject')} className="h-auto px-3 py-1.5 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white border-transparent text-xs font-bold">
                                    Reject
                                 </Button>
                              </td>
                           </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
               </div>
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <DocumentCenterTab
            approvedRecords={approvedForDocuments}
            allLoadedRecords={[...pendingLeaves, ...processedLeaves]}
            hrId={user?.id}
            onPrinted={() => queryClient.invalidateQueries({ queryKey: ['hrLeaves'] })}
          />
        )}

        {activeTab === 'history' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
             {loading ? (
              <div className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                <Spinner size="md" />
                <span className="text-sm font-medium">Loading history...</span>
              </div>
            ) : filteredProcessed.length === 0 ? (
               <div className="p-12 text-center text-muted-foreground font-medium bg-muted/20">No history found for the selected period.</div>
            ) : (
               <div className="flex flex-col">
                 <div className="p-4 border-b border-border flex justify-between items-center bg-muted/10">
                   <span className="text-sm font-bold text-foreground">{filteredProcessed.length} Records</span>
                 </div>
                 <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                        <th className="p-4">Employee</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Category</th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Hours</th>
                      <th className="p-4">Files</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Processed Date</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                      {filteredProcessed.map(req => {
                        const key = req.type + '-' + (req.leave_group_id || req.id);
                        return (
                          <tr key={key} className="hover:bg-muted/30 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <Avatar name={req.employee?.name} src={req.employee?.avatar_path} size="sm" />
                                <span className="text-sm font-bold text-foreground">{req.employee?.name}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${
                                req.type === 'OVERTIME' ? 'bg-primary/10 text-primary border-primary/20' :
                                req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' :
                                req.type === 'UNDERTIME' ? 'bg-amber-2 text-amber-11 border-amber-6' : 'bg-green-2 text-green-11 border-green-6'
                              }`}>
                                {req.type}
                              </span>
                            </td>
                            <td className="p-4 text-xs font-semibold text-foreground">
                              {req.category?.label || '-'}
                            </td>
                            <td className="p-4 text-sm font-bold text-foreground">
                              {req.dayCount > 1 ? (
                                <>
                                  {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  {' – '}
                                  {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  <span className="ml-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                                    {req.dayCount} days
                                  </span>
                                </>
                              ) : (
                                new Date(req.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-black text-sm text-foreground">
                                  {(req.type === 'OVERTIME' || req.type === 'OFFSET') && req.approved_hours != null && req.approved_hours !== req.hours ? (
                                    <>
                                      <span className="line-through text-muted-foreground mr-1.5">{req.hours}</span>
                                      {req.approved_hours} hrs
                                    </>
                                  ) : (
                                    `${req.hours} hrs`
                                  )}
                                </span>
                                {req.start_time && req.end_time && (
                                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                    {formatWindow(req.start_time, req.end_time)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              {req.attachments?.length ? (
                                <AttachmentList attachments={req.attachments} compact />
                              ) : (
                                <span className="text-xs text-muted-foreground/50">-</span>
                              )}
                            </td>
                            <td className="p-4">
                              {getStatusBadge(req.status)}
                            </td>
                            <td className="p-4 text-xs font-semibold text-muted-foreground">
                              {new Date(req.updated_at).toLocaleDateString()}
                            </td>
                            <td className="p-4 text-right flex items-center justify-end">
                              {req.verification_token && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setPreviewToken(req.verification_token)}
                                  className="h-auto text-xs font-bold text-blue-11 bg-blue-2 hover:bg-blue-3 border-blue-6 px-3 py-1.5 mr-2"
                                >
                                  Preview
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleUndo(req)}
                                className="h-auto text-xs font-bold text-amber-11 bg-amber-2 hover:bg-amber-3 border-amber-6 px-3 py-1.5"
                              >
                                Undo
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                 </div>
               </div>
            )}
          </div>
        )}

        {activeTab === 'balances' && (
           <>
             {balancesLayout === 'grid' ? (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-300">
                 {filteredBalances.map(emp => (
                    <div key={emp.id} className="bg-card border border-border rounded-xl p-5 hover:border-mauve-8 transition-colors shadow-sm flex flex-col gap-4">
                      <div className="flex items-center gap-3 border-b border-border pb-4">
                        <Avatar name={emp.name} src={emp.avatar_path} size="md" />
                        <div>
                          <p className="text-[15px] font-bold text-foreground">{emp.name}</p>
                          <p className="text-[13px] text-muted-foreground font-medium">{emp.department || 'No Department'}</p>
                          <p className="text-[11px] text-muted-foreground/80 font-medium">{emp.company?.name || 'No company'}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted rounded-lg p-3 border border-border flex flex-col justify-center">
                          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">Offset</p>
                          <div className="flex items-baseline gap-1">
                            <span className={`text-2xl font-black ${emp.offset_hours_balance > 0 ? 'text-green-11' : 'text-foreground'}`}>
                              {emp.offset_hours_balance}
                            </span>
                            <span className="text-xs text-muted-foreground font-bold tracking-tight">hrs</span>
                          </div>
                        </div>
                        
                        <div className="bg-muted rounded-lg p-3 border border-border flex flex-col justify-center">
                          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-wider mb-1">SIL</p>
                          <div className="flex items-baseline gap-1">
                            <span className={`text-2xl font-black ${emp.sil_hours_balance > 0 ? 'text-green-11' : 'text-foreground'}`}>
                              {emp.sil_hours_balance}
                            </span>
                            <span className="text-xs text-muted-foreground font-bold tracking-tight">hrs</span>
                          </div>
                        </div>
                      </div>
                    </div>
                 ))}
                 {filteredBalances.length === 0 && (
                   <div className="col-span-full py-16 text-center text-muted-foreground bg-muted border border-border rounded-xl border-dashed flex flex-col items-center justify-center gap-2">
                     <span className="text-sm font-medium">No employee balances found</span>
                   </div>
                 )}
               </div>
             ) : (
               <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden animate-in fade-in duration-300">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                      <thead>
                        <tr className="bg-muted border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                          <th className="p-4">Employee</th>
                          <th className="p-4">Company</th>
                          <th className="p-4">Offset Balance</th>
                          <th className="p-4">SIL Balance</th>
                          <th className="p-4">Undertime (this month)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredBalances.map(emp => (
                           <tr key={emp.id} className="hover:bg-muted/50 transition-colors">
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <Avatar name={emp.name} src={emp.avatar_path} size="sm" />
                                  <div>
                                    <p className="text-[14px] font-bold text-foreground">{emp.name}</p>
                                    <p className="text-[12px] text-muted-foreground font-medium">{emp.department || 'No Department'}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-4 text-sm">
                                {emp.company?.name ? (
                                  <span className="text-muted-foreground">{emp.company.name}</span>
                                ) : (
                                  <span className="text-amber-11 bg-amber-2 border border-amber-6 px-2 py-1 rounded text-xs font-bold">
                                    No company
                                  </span>
                                )}
                              </td>
                              <td className="p-4">
                                 <span className={`font-black text-sm px-3 py-1.5 rounded-lg border ${
                                   emp.offset_hours_balance > 0 ? 'bg-green-2 text-green-11 border-green-6' : 'bg-muted text-muted-foreground border-border'
                                 }`}>
                                   {emp.offset_hours_balance} hrs
                                 </span>
                              </td>
                               <td className="p-4">
                                 <span className={`font-black text-sm px-3 py-1.5 rounded-lg border ${
                                   emp.sil_hours_balance > 0 ? 'bg-green-2 text-green-11 border-green-6' : 'bg-muted text-muted-foreground border-border'
                                 }`}>
                                   {emp.sil_hours_balance} hrs
                                 </span>
                              </td>
                              <td className="p-4">
                                 {/* Derived from APPROVED undertime rows this calendar month — never a
                                     stored balance, so it is styled plainly rather than as a credit. */}
                                 <span className="font-bold text-sm px-3 py-1.5 rounded-lg border bg-muted text-muted-foreground border-border">
                                   {emp.undertime_this_month} hrs
                                 </span>
                              </td>
                           </tr>
                        ))}
                        {filteredBalances.length === 0 && (
                          <tr>
                            <td colSpan={3} className="py-16 text-center text-muted-foreground bg-muted">
                              No employee balances found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
               </div>
             )}
           </>
        )}
      </div>

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
    </PageContainer>
    </ProtectedRoute>
  );
}
