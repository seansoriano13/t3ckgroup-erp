import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { offsetService } from '../../../services/offsetService';
import { silService } from '../../../services/silService';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { Clock, CheckCircle2, XCircle, Search, Filter, Printer } from 'lucide-react';
import ProtectedRoute from '../../../components/ProtectedRoute.jsx';
import { printHtmlPdf } from '../../../lib/pdf/htmlPrinter';
import PageContainer from '../../../components/ui/PageContainer';
import PageHeader from '../../../components/ui/PageHeader';
import TabGroup from '../../../components/ui/TabGroup';
import NotionLeaveCalendar from '../../../components/hr/NotionLeaveCalendar';
import ApproveOvertimeModal from '../../../components/offsets/ApproveOvertimeModal';
import HrApplyLeaveModal from '../../../components/hr/HrApplyLeaveModal';
import FloatingMonthPicker from '../../../components/FloatingMonthPicker';
import Avatar from '../../../components/Avatar';
import { confirmActionToast } from '../../../components/ui/CustomToast';
import { AttachmentList } from '../../../components/ui/Attachments';
import { getMonthBoundaries } from '../../../utils/dateUtils';
import { formatWindow, isRequestInPendingPeriod } from '../../../utils/time';
import { groupLeaveRows } from '../../../utils/leaveGroups';

export default function HrLeavesManagerPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar', 'pending', 'history', 'balances'
  
  // Date Range State (for FloatingMonthPicker)
  const currentDate = new Date();
  const currentMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const initialBoundaries = getMonthBoundaries(currentMonthStr);

  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: initialBoundaries.startDate,
    endDate: initialBoundaries.endDate,
  });

  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [processedLeaves, setProcessedLeaves] = useState([]);
  const [approvedLeaves, setApprovedLeaves] = useState([]);
  const [employeeBalances, setEmployeeBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overtimeApproval, setOvertimeApproval] = useState(null); // { request, status }
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('ALL'); // 'ALL', 'OVERTIME', 'OFFSET', 'SIL'
  const [pendingPeriodFilter, setPendingPeriodFilter] = useState('ALL'); // 'ALL', 'THIS_MONTH', 'NEXT_MONTH', 'OVERDUE'

  // PDF Generation State
  const [selectedRecords, setSelectedRecords] = useState(new Set());
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Balances
      const { data: empData, error: empErr } = await supabase
        .from('employees')
        .select('id, name, department, avatar_path, offset_hours_balance, sil_hours_balance')
        .order('name');
      
      if (empErr) throw empErr;
      setEmployeeBalances(empData);

      // 2. Fetch Requests
      const [
        allOt,
        allOffset,
        allSil,
        pendingOt,
        pendingOffset,
        pendingSil
      ] = await Promise.all([
        offsetService.getAllOvertimeRequests(dateRange.startDate, dateRange.endDate),
        offsetService.getAllOffsetLeaves(dateRange.startDate, dateRange.endDate),
        silService.getAllSilLeaves(dateRange.startDate, dateRange.endDate),
        offsetService.getAllPendingOvertimeRequests(),
        offsetService.getAllPendingOffsetLeaves(),
        silService.getAllPendingSilLeaves()
      ]);

      // Tag types for period-scoped requests
      const taggedOt = allOt.map(l => ({ ...l, type: 'OVERTIME' }));
      const taggedOffset = allOffset.map(l => ({ ...l, type: 'OFFSET' }));
      const taggedSil = allSil.map(l => ({ ...l, type: 'SIL' }));
      const combined = [...taggedOt, ...taggedOffset, ...taggedSil];

      // Tag types for dateless pending requests
      const taggedPendingOt = pendingOt.map(l => ({ ...l, type: 'OVERTIME' }));
      const taggedPendingOffset = pendingOffset.map(l => ({ ...l, type: 'OFFSET' }));
      const taggedPendingSil = pendingSil.map(l => ({ ...l, type: 'SIL' }));
      // A range writes one row per day (see ticket #63), so rows sharing a
      // leave_group_id are collapsed into one entry before the queue is built —
      // otherwise a 3-day leave would show as three separate pending requests.
      const pendingCombined = groupLeaveRows([...taggedPendingOt, ...taggedPendingOffset, ...taggedPendingSil])
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Processed (from period-scoped) — grouped the same way as pending.
      const processed = groupLeaveRows(
        combined.filter(req => req.status !== 'PENDING' && req.status !== 'WITHDRAWN' && req.status !== 'CANCELLED')
      ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      // Approved feeds the calendar, which plots one card per day — left
      // ungrouped so every day in a range still gets its own cell.
      const approved = combined.filter(req => ['APPROVED', 'APPROVED_OFFSET', 'APPROVED_PAID'].includes(req.status) && (req.type === 'OFFSET' || req.type === 'SIL'));

      setPendingLeaves(pendingCombined);
      setProcessedLeaves(processed);
      setApprovedLeaves(approved);

    } catch (err) {
      console.error('Failed to load HR leave data:', err);
      toast.error('Could not load data.');
    } finally {
      setLoading(false);
    }
  }, [dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAction = useCallback((request, actionType) => {
    // actionType: 'approve', 'approve_paid' (for OT), 'reject'
    const isOT = request.type === 'OVERTIME';
    const isOffset = request.type === 'OFFSET';
    const isSIL = request.type === 'SIL';

    // Approving overtime lets HR edit the hours actually rendered before
    // they're credited, so it opens a modal rather than a plain confirm.
    if (isOT && actionType !== 'reject') {
      const status = actionType === 'approve' ? 'APPROVED_OFFSET' : 'APPROVED_PAID';
      setOvertimeApproval({ request, status });
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
          const status = actionType === 'approve' ? 'APPROVED' : 'REJECTED';
          await offsetService.handleOffsetLeaveDecision({ groupId: request.leave_group_id, status, hrId: user?.id });
        } else if (isSIL) {
          const status = actionType === 'approve' ? 'APPROVED' : 'REJECTED';
          await silService.handleSilLeaveDecision({ groupId: request.leave_group_id, status, hrId: user?.id });
        }
        toast.success(`Request ${actionLabel.toLowerCase()}d successfully.`);
        loadData();
      } catch (err) {
        toast.error(err.message || `Failed to ${actionLabel.toLowerCase()} request.`);
      }
    });
  }, [user?.id, loadData]);

  const handleUndo = useCallback((request) => {
    const isOT = request.type === 'OVERTIME';
    const isOffset = request.type === 'OFFSET';
    const isSIL = request.type === 'SIL';

    confirmActionToast(
      'Undo Decision',
      `Are you sure you want to undo this decision? The request will return to PENDING status and balances will be restored.`,
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
          }
          toast.success('Decision undone successfully.');
          loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to undo decision.');
        }
      }
    );
  }, [user?.id, loadData]);

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
      return true;
    });
  }, [pendingLeaves, leaveTypeFilter, searchQuery, pendingPeriodFilter]);

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
        return empName.includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [processedLeaves, leaveTypeFilter, searchQuery]);

  const filteredBalances = useMemo(() => {
    if (!searchQuery) return employeeBalances;
    return employeeBalances.filter(emp => emp.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [employeeBalances, searchQuery]);

  // --- Bulk Printing Handlers ---
  const toggleSelection = (key) => {
    const newSet = new Set(selectedRecords);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setSelectedRecords(newSet);
  };

  const toggleAll = () => {
    const approvedRecords = filteredProcessed.filter(r => r.status.startsWith('APPROVED'));
    if (selectedRecords.size === approvedRecords.length && approvedRecords.length > 0) {
      setSelectedRecords(new Set());
    } else {
      setSelectedRecords(new Set(approvedRecords.map(r => r.type + '-' + (r.leave_group_id || r.id))));
    }
  };

  const handlePrintSelected = async () => {
    setIsGeneratingPdf(true);
    try {
      const recordsToPrint = filteredProcessed.filter(r => selectedRecords.has(r.type + '-' + (r.leave_group_id || r.id)));
      if (recordsToPrint.length === 0) {
        toast.error("No records selected");
        return;
      }
      await printHtmlPdf(recordsToPrint);
    } catch (err) {
      toast.error(err.message || "Failed to generate PDF");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <ProtectedRoute requireHr={true} allowLeaveManagers={true}>
    <PageContainer className="pt-4 space-y-6 relative">
      <PageHeader 
        title="Offsets & Leaves" 
        subtitle="Manage overtime credits, leave requests, and balances"
      />

      <ApproveOvertimeModal
        isOpen={!!overtimeApproval}
        onClose={() => setOvertimeApproval(null)}
        request={overtimeApproval?.request}
        status={overtimeApproval?.status}
        hrId={user?.id}
        onSuccess={loadData}
      />

      <FloatingMonthPicker
        selectedRange={dateRange}
        onChange={setDateRange}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="HR Leaves & Overtime Manager"
          description="Review leave applications, approve overtime, and manage employee balances."
        />
        <button
          onClick={() => setIsApplyModalOpen(true)}
          className="flex-none bg-primary text-primary-foreground font-black px-5 py-2.5 rounded-xl shadow-sm border border-border/10 hover:bg-primary/90 transition-colors uppercase tracking-widest text-xs flex items-center gap-2"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
          File for Employee
        </button>
      </div>

      <HrApplyLeaveModal 
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={loadData}
      />

      <div className="space-y-4">
        <TabGroup
          variant="pill"
          tabs={[
            { value: 'calendar', label: `Calendar` },
            { value: 'pending', label: `Pending Requests (${pendingLeaves.length})` },
            { value: 'history', label: `Decision History` },
            { value: 'balances', label: `Employee Balances` },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          size="md"
        />

        {/* Toolbar (Search & Filter) for list views */}
        {(activeTab === 'pending' || activeTab === 'history' || activeTab === 'balances') && (
           <div className="flex flex-col sm:flex-row gap-3">
             <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 text-foreground"
                />
              </div>
              
              {(activeTab === 'pending' || activeTab === 'history') && (
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
              <div className="p-8 text-center text-muted-foreground">Loading pending requests...</div>
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
                          <td colSpan="7" className="bg-muted/30 px-4 py-2 text-xs font-bold text-foreground border-y border-border/50">
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
                                  req.type === 'OVERTIME' ? 'bg-primary/10 text-primary border-primary/20' :
                                  req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' : 'bg-green-2 text-green-11 border-green-6'
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
                                      <button onClick={() => handleAction(req, 'approve')} className="px-3 py-1.5 bg-green-2 text-green-11 hover:bg-green-3 border border-green-6 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                                        Approve (Offset)
                                      </button>
                                      <button onClick={() => handleAction(req, 'approve_paid')} className="px-3 py-1.5 bg-blue-2 text-blue-11 hover:bg-blue-3 border border-blue-6 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                                        Approve (Paid)
                                      </button>
                                    </>
                                 ) : (
                                    <button onClick={() => handleAction(req, 'approve')} className="px-3 py-1.5 bg-green-2 text-green-11 hover:bg-green-3 border border-green-6 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                                        Approve
                                    </button>
                                 )}
                                 <button onClick={() => handleAction(req, 'reject')} className="px-3 py-1.5 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white rounded-lg text-xs font-bold transition-colors cursor-pointer">
                                    Reject
                                 </button>
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

        {activeTab === 'history' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
             {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading history...</div>
            ) : filteredProcessed.length === 0 ? (
               <div className="p-12 text-center text-muted-foreground font-medium bg-muted/20">No history found for the selected period.</div>
            ) : (
               <div className="flex flex-col">
                 <div className="p-4 border-b border-border flex justify-between items-center bg-muted/10">
                   <span className="text-sm font-bold text-foreground">{filteredProcessed.length} Records</span>
                   {selectedRecords.size > 0 && (
                     <button onClick={handlePrintSelected} disabled={isGeneratingPdf} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-bold transition-colors cursor-pointer disabled:opacity-50">
                       <Printer className="w-4 h-4" />
                       {isGeneratingPdf ? 'Generating...' : `Print ${selectedRecords.size} Selected`}
                     </button>
                   )}
                 </div>
                 <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                        <th className="p-4 w-10">
                          <input 
                            type="checkbox" 
                            className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                            checked={
                              filteredProcessed.filter(r => r.status.startsWith('APPROVED')).length > 0 &&
                              selectedRecords.size === filteredProcessed.filter(r => r.status.startsWith('APPROVED')).length
                            }
                            onChange={toggleAll}
                          />
                        </th>
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
                        const isApproved = req.status.startsWith('APPROVED');
                        return (
                          <tr key={key} className={`hover:bg-muted/30 transition-colors ${selectedRecords.has(key) ? 'bg-primary/5' : ''}`}>
                            <td className="p-4">
                              {isApproved && (
                                <input 
                                  type="checkbox"
                                  className="rounded border-border text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                                  checked={selectedRecords.has(key)}
                                  onChange={() => toggleSelection(key)}
                                />
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <Avatar name={req.employee?.name} src={req.employee?.avatar_path} size="sm" />
                                <span className="text-sm font-bold text-foreground">{req.employee?.name}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${
                                req.type === 'OVERTIME' ? 'bg-primary/10 text-primary border-primary/20' :
                                req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' : 'bg-green-2 text-green-11 border-green-6'
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
                                  {req.type === 'OVERTIME' && req.approved_hours != null && req.approved_hours !== req.hours ? (
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
                            <td className="p-4 text-right">
                              <button
                                onClick={() => handleUndo(req)}
                                className="text-xs font-bold text-amber-11 bg-amber-2 hover:bg-amber-3 border border-amber-6 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                              >
                                Undo
                              </button>
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
           <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                      <th className="p-4">Employee</th>
                      <th className="p-4">Offset Balance</th>
                      <th className="p-4">SIL Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredBalances.map(emp => (
                       <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <Avatar name={emp.name} src={emp.avatar_path} size="sm" />
                              <div>
                                <p className="text-sm font-bold text-foreground">{emp.name}</p>
                                <p className="text-xs text-muted-foreground font-medium">{emp.department}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                             <span className={`font-black text-sm px-3 py-1 rounded-lg border ${
                               emp.offset_hours_balance > 0 ? 'bg-blue-2 text-blue-11 border-blue-6' : 'bg-muted text-muted-foreground border-border'
                             }`}>
                               {emp.offset_hours_balance} hrs
                             </span>
                          </td>
                           <td className="p-4">
                             <span className={`font-black text-sm px-3 py-1 rounded-lg border ${
                               emp.sil_hours_balance > 0 ? 'bg-green-2 text-green-11 border-green-6' : 'bg-muted text-muted-foreground border-border'
                             }`}>
                               {emp.sil_hours_balance} hrs
                             </span>
                          </td>
                       </tr>
                    ))}
                  </tbody>
                </table>
              </div>
           </div>
        )}

      </div>
    </PageContainer>
    </ProtectedRoute>
  );
}
