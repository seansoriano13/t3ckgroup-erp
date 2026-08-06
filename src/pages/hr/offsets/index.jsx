import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { offsetService } from '../../../services/offsetService';
import NotionOffsetCalendar from '../../../components/hr/NotionOffsetCalendar';
import ProtectedRoute from '../../../components/ProtectedRoute.jsx';
import PageContainer from '../../../components/ui/PageContainer';
import PageHeader from '../../../components/ui/PageHeader';
import TabGroup from '../../../components/ui/TabGroup';
import Avatar from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Dropdown from '../../../components/ui/Dropdown';
import { FilterTrigger, FilterOptionList } from '../../../components/ui/FilterDropdown';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, DollarSign, RefreshCw, Search, SlidersHorizontal, Building2, RotateCcw } from 'lucide-react';
import FloatingMonthPicker from '../../../components/FloatingMonthPicker';
import { confirmDeleteToast } from '../../../components/ui/CustomToast';

export default function HROffsetManagerPage() {
  const { user } = useAuth();
  const [overtimeRequests, setOvertimeRequests] = useState([]);
  const [offsetLeaves, setOffsetLeaves] = useState([]);
  const [employeeBalances, setEmployeeBalances] = useState([]);
  const [loading, setLoading] = useState(true);

  // Tab State
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar', 'overtime', 'leaves', 'history', 'balances'

  // Date Range State (for FloatingMonthPicker)
  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: new Date().toISOString().slice(0, 7) + '-01',
    endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
  });

  // Employee Balances Filters & Sort State
  const [searchTerm, setSearchTerm] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('BAL_DESC'); // 'BAL_DESC', 'BAL_ASC', 'NAME_ASC', 'NAME_DESC'

  // Notes Modal State
  const [actionItem, setActionItem] = useState(null); // { type: 'OT'|'LEAVE', id, decision: string }
  const [hrNotes, setHrNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadAllData();
  }, [dateRange]); // Reload when date range changes

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [otData, lvData, balData] = await Promise.all([
        offsetService.getAllOvertimeRequests(dateRange.startDate, dateRange.endDate),
        offsetService.getAllOffsetLeaves(dateRange.startDate, dateRange.endDate),
        offsetService.getEmployeeOffsetBalances(), // Balances are global, not date-bound
      ]);
      setOvertimeRequests(otData);
      setOffsetLeaves(lvData);
      setEmployeeBalances(balData);
    } catch (err) {
      console.error('Failed to load HR offset data:', err);
      toast.error('Failed to load HR offset manager data.');
    } finally {
      setLoading(false);
    }
  };

  const handleOvertimeDecision = async (requestId, status) => {
    setProcessing(true);
    try {
      await offsetService.handleOvertimeDecision({
        requestId,
        status,
        hrNotes,
        hrId: user.id,
      });
      toast.success(`Overtime request marked as ${status}.`);
      setActionItem(null);
      setHrNotes('');
      loadAllData();
    } catch (err) {
      toast.error(err.message || 'Action failed.');
    } finally {
      setProcessing(false);
    }
  };

  const handleLeaveDecision = async (leaveId, status) => {
    setProcessing(true);
    try {
      await offsetService.handleOffsetLeaveDecision({
        leaveId,
        status,
        hrNotes,
        hrId: user.id,
      });
      toast.success(`Offset leave request ${status.toLowerCase()}.`);
      setActionItem(null);
      setHrNotes('');
      loadAllData();
    } catch (err) {
      toast.error(err.message || 'Action failed.');
    } finally {
      setProcessing(false);
    }
  };

  const handleUndoAction = (type, id) => {
    confirmDeleteToast(
      'Undo Action',
      'Are you sure you want to revert this decision? The employee balance will be adjusted accordingly.',
      async () => {
        setProcessing(true);
        try {
          if (type === 'OT') {
            await offsetService.undoOvertimeDecision({ requestId: id, hrId: user.id });
          } else {
            await offsetService.undoOffsetLeaveDecision({ leaveId: id, hrId: user.id });
          }
          toast.success('Action successfully reverted to PENDING.');
          loadAllData();
        } catch (err) {
          toast.error(err.message || 'Undo failed.');
        } finally {
          setProcessing(false);
        }
      }
    );
  };

  const approvedLeaves = offsetLeaves.filter((l) => l.status === 'APPROVED');
  const pendingOT = overtimeRequests.filter((r) => r.status === 'PENDING');
  const pendingLeaves = offsetLeaves.filter((l) => l.status === 'PENDING');
  
  // History items (processed)
  const processedOT = overtimeRequests.filter((r) => r.status !== 'PENDING' && r.status !== 'CANCELLED' && r.status !== 'WITHDRAWN');
  const processedLeaves = offsetLeaves.filter((l) => l.status !== 'PENDING' && l.status !== 'CANCELLED' && l.status !== 'WITHDRAWN');

  // Filtered and Ranked Employee Balances
  const uniqueDepts = useMemo(() => {
    return [...new Set(employeeBalances.map((e) => e.department).filter(Boolean))].sort();
  }, [employeeBalances]);

  const filteredBalances = useMemo(() => {
    let list = [...employeeBalances];

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((e) => e.name?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q));
    }

    if (deptFilter !== 'ALL') {
      list = list.filter((e) => e.department === deptFilter);
    }

    // Sort logic
    list.sort((a, b) => {
      const balA = parseFloat(a.offset_hours_balance || 0);
      const balB = parseFloat(b.offset_hours_balance || 0);

      if (sortBy === 'BAL_DESC') return balB - balA;
      if (sortBy === 'BAL_ASC') return balA - balB;
      if (sortBy === 'NAME_ASC') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'NAME_DESC') return (b.name || '').localeCompare(a.name || '');
      return 0;
    });

    return list;
  }, [employeeBalances, searchTerm, deptFilter, sortBy]);

  const sortOptions = [
    { value: 'BAL_DESC', label: 'Highest Offset Hours' },
    { value: 'BAL_ASC', label: 'Lowest Offset Hours' },
    { value: 'NAME_ASC', label: 'Name (A–Z)' },
    { value: 'NAME_DESC', label: 'Name (Z–A)' },
  ];

  const deptOptions = [
    { value: 'ALL', label: 'All Departments' },
    ...uniqueDepts.map((d) => ({ value: d, label: d })),
  ];

  const currentSortLabel = sortOptions.find((o) => o.value === sortBy)?.label || sortOptions[0].label;
  const currentDeptLabel = deptOptions.find((o) => o.value === deptFilter)?.label || deptOptions[0].label;

  return (
    <ProtectedRoute requireHr={true}>
      <PageContainer className="pt-4 space-y-6">
        
        {/* Floating Month Picker at the top */}
        <FloatingMonthPicker
          selectedRange={dateRange}
          onChange={setDateRange}
        />

        {/* Header */}
        <div className="flex items-center justify-between">
          <PageHeader
            title="HR Offset Manager"
            description="Review employee applications, manage offset balances, and view the leave calendar."
          />

          <Button
            variant="outline"
            size="sm"
            onClick={loadAllData}
            disabled={loading}
            className="rounded-xl gap-2 font-bold cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {/* Tabs */}
        <TabGroup
          variant="pill"
          tabs={[
            { value: 'calendar', label: `Calendar (${approvedLeaves.length})` },
            { value: 'overtime', label: `Pending OT (${pendingOT.length})` },
            { value: 'leaves', label: `Pending Leaves (${pendingLeaves.length})` },
            { value: 'history', label: `History & Undo` },
            { value: 'balances', label: 'Employee Balances' },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
          size="md"
        />

        {/* Tab Content */}
        {loading ? (
          <div className="py-12 text-center text-xs font-bold text-muted-foreground italic">
            Loading offset manager data for selected date range...
          </div>
        ) : (
          <div>
            {/* Calendar View */}
            {activeTab === 'calendar' && (
              <NotionOffsetCalendar 
                approvedLeaves={approvedLeaves} 
                targetDate={dateRange.startDate}
              />
            )}

            {/* Pending Overtime Requests */}
            {activeTab === 'overtime' && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
                <h2 className="text-sm font-black text-foreground uppercase tracking-wider">
                  Pending Overtime Applications
                </h2>

                {pendingOT.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground font-bold italic">
                    No pending overtime applications for the selected date range.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingOT.map((req) => (
                      <div
                        key={req.id}
                        className="p-4 bg-muted/40 border border-border rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-center space-x-3">
                          <Avatar
                            name={req.employee?.name || 'E'}
                            size="md"
                            className="w-10 h-10 rounded-xl"
                          />
                          <div>
                            <p className="text-sm font-bold text-foreground">
                              {req.employee?.name}{' '}
                              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                ({req.employee?.department || 'Staff'})
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground font-medium">
                              Worked <span className="font-bold text-foreground">{req.hours} hrs</span> on{' '}
                              <span className="font-bold text-foreground">
                                {new Date(req.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() =>
                              setActionItem({
                                type: 'OT',
                                id: req.id,
                                decision: 'APPROVED_OFFSET',
                                hours: req.hours,
                                name: req.employee?.name,
                              })
                            }
                            className="px-3 py-1.5 bg-green-9 hover:bg-green-10 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <CheckCircle2 size={13} /> Approve Offset
                          </button>
                          <button
                            onClick={() =>
                              setActionItem({
                                type: 'OT',
                                id: req.id,
                                decision: 'APPROVED_PAID',
                                hours: req.hours,
                                name: req.employee?.name,
                              })
                            }
                            className="px-3 py-1.5 bg-blue-9 hover:bg-blue-10 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <DollarSign size={13} /> Approve Paid OT
                          </button>
                          <button
                            onClick={() =>
                              setActionItem({
                                type: 'OT',
                                id: req.id,
                                decision: 'REJECTED',
                                hours: req.hours,
                                name: req.employee?.name,
                              })
                            }
                            className="px-3 py-1.5 bg-red-9 hover:bg-destructive/90 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending Offset Leaves */}
            {activeTab === 'leaves' && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
                <h2 className="text-sm font-black text-foreground uppercase tracking-wider">
                  Pending Offset Leave Applications
                </h2>

                {pendingLeaves.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground font-bold italic">
                    No pending leave applications for the selected date range.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingLeaves.map((leave) => (
                      <div
                        key={leave.id}
                        className="p-4 bg-muted/40 border border-border rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-center space-x-3">
                          <Avatar
                            name={leave.employee?.name || 'E'}
                            size="md"
                            className="w-10 h-10 rounded-xl"
                          />
                          <div>
                            <p className="text-sm font-bold text-foreground">
                              {leave.employee?.name}{' '}
                              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                ({leave.employee?.department || 'Staff'})
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground font-medium">
                              Requesting <span className="font-bold text-foreground">{leave.hours} hrs</span> offset leave on{' '}
                              <span className="font-bold text-foreground">
                                {new Date(leave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                              </span>
                            </p>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                              Current Balance: {leave.employee?.offset_hours_balance || 0} hrs
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              setActionItem({
                                type: 'LEAVE',
                                id: leave.id,
                                decision: 'APPROVED',
                                hours: leave.hours,
                                name: leave.employee?.name,
                              })
                            }
                            className="px-3.5 py-1.5 bg-green-9 hover:bg-green-10 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <CheckCircle2 size={13} /> Approve Leave
                          </button>
                          <button
                            onClick={() =>
                              setActionItem({
                                type: 'LEAVE',
                                id: leave.id,
                                decision: 'REJECTED',
                                hours: leave.hours,
                                name: leave.employee?.name,
                              })
                            }
                            className="px-3.5 py-1.5 bg-red-9 hover:bg-destructive/90 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* History & Undo */}
            {activeTab === 'history' && (
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-8">
                
                {/* Processed Overtime */}
                <div className="space-y-4">
                  <h2 className="text-sm font-black text-foreground uppercase tracking-wider border-b border-border pb-2">
                    Processed Overtime Requests
                  </h2>
                  {processedOT.length === 0 ? (
                    <div className="py-4 text-xs text-muted-foreground font-bold italic">No processed overtime requests.</div>
                  ) : (
                    <div className="space-y-2">
                      {processedOT.map((req) => (
                        <div key={req.id} className="p-3 bg-muted/30 border border-border rounded-xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={req.employee?.name} size="sm" className="w-8 h-8 rounded-lg" />
                            <div>
                              <p className="text-xs font-bold text-foreground">{req.employee?.name}</p>
                              <p className="text-[10px] text-muted-foreground font-medium">
                                {req.hours} hrs on {new Date(req.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} &mdash; <span className="font-bold text-primary">{req.status}</span>
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUndoAction('OT', req.id)}
                            disabled={processing}
                            className="px-2.5 py-1.5 bg-muted hover:bg-muted-foreground/20 border border-border text-foreground rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw size={12} /> Undo
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Processed Leaves */}
                <div className="space-y-4">
                  <h2 className="text-sm font-black text-foreground uppercase tracking-wider border-b border-border pb-2">
                    Processed Offset Leaves
                  </h2>
                  {processedLeaves.length === 0 ? (
                    <div className="py-4 text-xs text-muted-foreground font-bold italic">No processed leave applications.</div>
                  ) : (
                    <div className="space-y-2">
                      {processedLeaves.map((leave) => (
                        <div key={leave.id} className="p-3 bg-muted/30 border border-border rounded-xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={leave.employee?.name} size="sm" className="w-8 h-8 rounded-lg" />
                            <div>
                              <p className="text-xs font-bold text-foreground">{leave.employee?.name}</p>
                              <p className="text-[10px] text-muted-foreground font-medium">
                                {leave.hours} hrs on {new Date(leave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} &mdash; <span className="font-bold text-primary">{leave.status}</span>
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUndoAction('LEAVE', leave.id)}
                            disabled={processing}
                            className="px-2.5 py-1.5 bg-muted hover:bg-muted-foreground/20 border border-border text-foreground rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw size={12} /> Undo
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Employee Balances Overview */}
            {activeTab === 'balances' && (
              <div className="space-y-4">
                {/* Search & Filters */}
                <div className="bg-card border border-border p-4 rounded-2xl flex flex-col md:flex-row items-center gap-3 shadow-sm">
                  <div className="relative flex-1 w-full">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      size={18}
                    />
                    <Input
                      type="text"
                      placeholder="Search employee by name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 block h-[42px]"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    {/* Sort Dropdown */}
                    <Dropdown
                      usePortal={true}
                      className="min-w-[190px]"
                      trigger={({ isOpen }) => (
                        <FilterTrigger
                          label={currentSortLabel}
                          isActive={sortBy !== 'BAL_DESC'}
                          isOpen={isOpen}
                          icon={SlidersHorizontal}
                        />
                      )}
                    >
                      {({ close }) => (
                        <FilterOptionList
                          options={sortOptions}
                          value={sortBy}
                          onChange={setSortBy}
                          close={close}
                        />
                      )}
                    </Dropdown>

                    {/* Dept Filter Dropdown */}
                    <Dropdown
                      usePortal={true}
                      className="min-w-[180px]"
                      trigger={({ isOpen }) => (
                        <FilterTrigger
                          label={currentDeptLabel}
                          isActive={deptFilter !== 'ALL'}
                          isOpen={isOpen}
                          icon={Building2}
                        />
                      )}
                    >
                      {({ close }) => (
                        <FilterOptionList
                          options={deptOptions}
                          value={deptFilter}
                          onChange={setDeptFilter}
                          close={close}
                        />
                      )}
                    </Dropdown>
                  </div>
                </div>

                {/* Balances Table */}
                <div className="bg-card border border-border rounded-2xl shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                        <th className="p-4">Rank / Employee Name</th>
                        <th className="p-4">Department</th>
                        <th className="p-4">Sub-Department</th>
                        <th className="p-4">Accrued Offset Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredBalances.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="p-8 text-center text-muted-foreground font-bold italic text-sm">
                            No employees match your search or filter.
                          </td>
                        </tr>
                      ) : (
                        filteredBalances.map((emp, idx) => (
                          <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                            <td className="p-4 text-sm font-bold text-foreground flex items-center gap-3">
                              <span className="w-6 text-center text-xs font-black text-muted-foreground">
                                #{idx + 1}
                              </span>
                              <Avatar
                                name={emp.name}
                                size="md"
                                className="w-8 h-8 rounded-xl"
                              />
                              <span>{emp.name}</span>
                            </td>
                            <td className="p-4 text-sm text-muted-foreground font-medium">{emp.department || '—'}</td>
                            <td className="p-4 text-sm text-muted-foreground font-medium">{emp.sub_department || '—'}</td>
                            <td className="p-4 text-sm font-black text-green-11">
                              {parseFloat(emp.offset_hours_balance || 0).toFixed(1)} hrs
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Confirmation Modal */}
        {actionItem && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
              <h3 className="font-black text-foreground text-sm">
                Confirm Action for {actionItem.name}
              </h3>
              <p className="text-xs text-muted-foreground font-medium">
                You are about to mark this request as{' '}
                <span className="font-bold text-foreground">{actionItem.decision}</span>.
              </p>

              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                  HR Remarks (Optional)
                </label>
                <textarea
                  value={hrNotes}
                  onChange={(e) => setHrNotes(e.target.value)}
                  placeholder="Reason or notes..."
                  className="w-full p-3 bg-muted border border-border rounded-xl text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  rows={2}
                />
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setActionItem(null)}
                  className="flex-1 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (actionItem.type === 'OT') {
                      handleOvertimeDecision(actionItem.id, actionItem.decision);
                    } else {
                      handleLeaveDecision(actionItem.id, actionItem.decision);
                    }
                  }}
                  disabled={processing}
                  className="flex-1 rounded-xl text-xs font-bold cursor-pointer"
                >
                  {processing ? 'Processing...' : 'Confirm'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PageContainer>
    </ProtectedRoute>
  );
}
