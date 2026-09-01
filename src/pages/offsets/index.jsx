import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Clock, PlusCircle, CheckCircle2, XCircle, Trash2, CalendarDays, Filter } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import PageContainer from '../../components/ui/PageContainer';
import PageHeader from '../../components/ui/PageHeader';
import TabGroup from '../../components/ui/TabGroup';
import { Button } from '@/components/ui/button';
import FloatingMonthPicker from '../../components/FloatingMonthPicker';
import NotionLeaveCalendar from '../../components/hr/NotionLeaveCalendar';
import ApplyLeaveModal from '../../components/offsets/ApplyLeaveModal';
import { confirmDeleteToast } from '../../components/ui/CustomToast';
import { AttachmentList } from '../../components/ui/Attachments';
import { getMonthBoundaries } from '../../utils/dateUtils';
import { formatWindow } from '../../utils/time';

export default function EmployeeLeavesPage() {
  const { user } = useAuth();
  const [offsetBalance, setOffsetBalance] = useState(user?.offset_hours_balance || 0);
  const [silBalance, setSilBalance] = useState(user?.sil_hours_balance || 0);
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar', 'overtime', 'leave'
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('ALL'); // 'ALL', 'OFFSET', 'SIL'

  // Date Range State (for FloatingMonthPicker)
  const currentDate = new Date();
  const currentMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const initialBoundaries = getMonthBoundaries(currentMonthStr);

  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: initialBoundaries.startDate,
    endDate: initialBoundaries.endDate,
  });

  const [overtimeHistory, setOvertimeHistory] = useState([]);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [globalApprovedLeaves, setGlobalApprovedLeaves] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoadingHistory(true);
    try {
      const [
        otData, 
        offsetLvData, 
        allOffsetLeavesData,
        silLvData,
        allSilLeavesData
      ] = await Promise.all([
        offsetService.getMyOvertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyOffsetLeaves(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getAllOffsetLeaves(dateRange.startDate, dateRange.endDate), // Filtered by RLS
        silService.getMySilLeaves(user.id, dateRange.startDate, dateRange.endDate),
        silService.getAllSilLeaves(dateRange.startDate, dateRange.endDate) // Filtered by RLS
      ]);

      setOvertimeHistory(otData);

      // Map and tag leaves
      const mappedOffsetLv = offsetLvData.map(l => ({ ...l, type: 'OFFSET' }));
      const mappedSilLv = silLvData.map(l => ({ ...l, type: 'SIL' }));
      
      const combinedLeaveHistory = [...mappedOffsetLv, ...mappedSilLv].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setLeaveHistory(combinedLeaveHistory);

      const approvedOffset = allOffsetLeavesData.filter(l => l.status === 'APPROVED').map(l => ({ ...l, type: 'OFFSET' }));
      const approvedSil = allSilLeavesData.filter(l => l.status === 'APPROVED').map(l => ({ ...l, type: 'SIL' }));
      setGlobalApprovedLeaves([...approvedOffset, ...approvedSil]);

      // Refresh balances
      const { data: empData } = await supabase
        .from('employees')
        .select('offset_hours_balance, sil_hours_balance')
        .eq('id', user.id)
        .single();

      if (empData) {
        setOffsetBalance(empData.offset_hours_balance);
        setSilBalance(empData.sil_hours_balance);
      }
    } catch (err) {
      console.error('Failed to load leave data:', err);
      toast.error('Could not load history or calendar.');
    } finally {
      setLoadingHistory(false);
    }
  }, [user?.id, dateRange.startDate, dateRange.endDate]);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id, loadData]);

  const handleWithdrawOvertime = useCallback((id) => {
    confirmDeleteToast(
      'Withdraw Overtime Request',
      'Are you sure you want to withdraw this overtime request? This cannot be undone.',
      async () => {
        try {
          await offsetService.withdrawOvertimeRequest({ requestId: id, employeeId: user?.id });
          toast.success('Overtime request withdrawn successfully.');
          loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  }, [user?.id, loadData]);

  const handleWithdrawLeave = useCallback((id, status, type) => {
    confirmDeleteToast(
      'Withdraw Leave Request',
      'Are you sure you want to withdraw this leave request? This cannot be undone.',
      async () => {
        try {
          if (type === 'OFFSET') {
            await offsetService.withdrawOffsetLeave({ leaveId: id, employeeId: user?.id });
          } else {
            await silService.cancelMySilLeave({ leaveId: id, employeeId: user?.id });
          }
          toast.success('Leave request withdrawn successfully.');
          loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  }, [user?.id, loadData]);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'APPROVED_OFFSET':
        return (
          <span className="bg-green-2 text-green-11 border border-green-6 px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved (Offset)
          </span>
        );
      case 'APPROVED_PAID':
        return (
          <span className="bg-blue-2 text-blue-11 border border-blue-6 px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved (Paid OT)
          </span>
        );
      case 'APPROVED':
        return (
          <span className="bg-green-2 text-green-11 border border-green-6 px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <CheckCircle2 size={12} /> Approved
          </span>
        );
      case 'REJECTED':
        return (
          <span className="bg-red-2 text-red-11 border border-red-6 px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <XCircle size={12} /> Rejected
          </span>
        );
      case 'CANCELLED':
      case 'WITHDRAWN':
        return (
          <span className="bg-muted text-muted-foreground border border-border px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <XCircle size={12} /> Withdrawn
          </span>
        );
      default:
        return (
          <span className="bg-amber-2 text-amber-11 border border-amber-6 px-2.5 py-1 rounded-lg font-black text-[10px] inline-flex items-center gap-1 uppercase tracking-wider">
            <Clock size={12} /> Pending HR
          </span>
        );
    }
  };

  const filteredLeaveHistory = useMemo(() => {
    if (leaveTypeFilter === 'ALL') return leaveHistory;
    return leaveHistory.filter(l => l.type === leaveTypeFilter);
  }, [leaveHistory, leaveTypeFilter]);

  return (
    <ProtectedRoute>
      <PageContainer className="pt-4 space-y-6 relative">

      {/* Date Picker Overlay */}
      <FloatingMonthPicker
        selectedRange={dateRange}
        onChange={setDateRange}
      />

      {/* Header */}
      <div className="p-6 bg-card border border-border rounded-2xl shadow-sm">
        <PageHeader
          title="Leaves & Overtime"
          description="Manage your leave balances, apply for time off, and track your overtime."
        />
      </div>

      {/* History Tabs & Actions */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <TabGroup
            variant="pill"
            tabs={[
              { value: 'calendar', label: `Calendar` },
              { value: 'overtime', label: `My Overtime (${overtimeHistory.length})` },
              { value: 'leave', label: `My Leaves (${leaveHistory.length})` },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
            <div className="bg-muted border border-border px-5 py-3 rounded-xl flex flex-col justify-center">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest text-blue-11/80">Available Offset Hours</p>
              <p className="text-2xl font-black text-blue-11">{parseFloat(offsetBalance).toFixed(1)} <span className="text-xs font-medium text-muted-foreground">hrs</span></p>
            </div>
            
            <div className="bg-muted border border-border px-5 py-3 rounded-xl flex flex-col justify-center">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest text-green-11/80">Available SIL Hours</p>
              <p className="text-2xl font-black text-green-11">{parseFloat(silBalance).toFixed(1)} <span className="text-xs font-medium text-muted-foreground">hrs</span></p>
            </div>

            <Button
              onClick={() => setIsApplyModalOpen(true)}
              className="h-full min-h-[64px] px-6 rounded-xl font-bold shadow-md shadow-primary/20 flex items-center gap-2 cursor-pointer"
            >
              <PlusCircle size={18} />
              Apply Leave / OT
            </Button>
          </div>
        </div>

        {activeTab === 'calendar' && (
          <div className="animate-in fade-in duration-300">
            <NotionLeaveCalendar
              approvedLeaves={globalApprovedLeaves}
              currentUserId={user?.id}
              onWithdrawLeave={(id, status, type) => handleWithdrawLeave(id, status, type)}
              targetDate={dateRange.startDate}
            />
          </div>
        )}

        {activeTab === 'overtime' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
            {loadingHistory ? (
              <div className="p-8 text-center text-muted-foreground text-sm font-bold flex flex-col items-center gap-3">
                <Clock className="animate-spin" size={24} />
                Loading overtime history...
              </div>
            ) : overtimeHistory.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-center bg-muted/20 border-t border-border">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4 text-muted-foreground/50">
                  <Clock size={32} />
                </div>
                <h3 className="text-lg font-black text-foreground mb-1 tracking-tight">No overtime requests found</h3>
                <p className="text-sm font-semibold text-muted-foreground max-w-sm">
                  You haven't requested any overtime in the selected month.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                      <th className="p-4">Applied On</th>
                      <th className="p-4">Date Worked</th>
                      <th className="p-4">Hours</th>
                      <th className="p-4">Files</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">HR Notes</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {overtimeHistory.map((req) => (
                      <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 text-xs text-muted-foreground font-medium">
                          {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="p-4 text-sm font-bold text-foreground">
                          {new Date(req.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-black text-primary bg-primary/10 px-2 py-0.5 rounded text-xs border border-primary/20 w-fit">
                              {req.hours} hrs
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
                        <td className="p-4 text-xs font-semibold text-muted-foreground truncate max-w-[200px]" title={req.hr_notes}>
                          {req.hr_notes || '-'}
                        </td>
                        <td className="p-4 text-right">
                          {req.status === 'PENDING' && (
                            <button
                              onClick={() => handleWithdrawOvertime(req.id)}
                              className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all inline-block border border-transparent hover:border-destructive/20 cursor-pointer"
                              title="Withdraw Request"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'leave' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300 flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
              <h3 className="font-black text-sm text-foreground">Leave History</h3>
              <div className="flex items-center space-x-2">
                <Filter size={14} className="text-muted-foreground" />
                <select
                  value={leaveTypeFilter}
                  onChange={(e) => setLeaveTypeFilter(e.target.value)}
                  className="bg-card border border-border rounded-lg text-xs font-bold px-2 py-1 outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer text-foreground"
                >
                  <option value="ALL">All Types</option>
                  <option value="OFFSET">Offset</option>
                  <option value="SIL">SIL</option>
                </select>
              </div>
            </div>

            {loadingHistory ? (
              <div className="p-8 text-center text-muted-foreground text-sm font-bold flex flex-col items-center gap-3">
                <Clock className="animate-spin" size={24} />
                Loading leaves...
              </div>
            ) : filteredLeaveHistory.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-center bg-muted/20 border-t border-border">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4 text-muted-foreground/50">
                  <CalendarDays size={32} />
                </div>
                <h3 className="text-lg font-black text-foreground mb-1 tracking-tight">No leaves found</h3>
                <p className="text-sm font-semibold text-muted-foreground max-w-sm">
                  You haven't applied for any leaves in the selected month that match this filter.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                      <th className="p-4">Applied On</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Leave Date</th>
                      <th className="p-4">Hours</th>
                      <th className="p-4">Reason</th>
                      <th className="p-4">Files</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">HR Notes</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLeaveHistory.map((req) => (
                      <tr key={req.type + '-' + req.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 text-xs text-muted-foreground font-medium">
                          {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="p-4">
                           <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${
                            req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' : 'bg-green-2 text-green-11 border-green-6'
                          }`}>
                            {req.type}
                          </span>
                        </td>
                        <td className="p-4 text-sm font-bold text-foreground">
                          {new Date(req.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
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
                        <td className="p-4">
                          {getStatusBadge(req.status)}
                        </td>
                        <td className="p-4 text-xs font-semibold text-muted-foreground truncate max-w-[150px]" title={req.hr_notes}>
                          {req.hr_notes || '-'}
                        </td>
                        <td className="p-4 text-right">
                          {req.status === 'PENDING' && (
                            <button
                              onClick={() => handleWithdrawLeave(req.id, req.status, req.type)}
                              className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all inline-block border border-transparent hover:border-destructive/20 cursor-pointer"
                              title="Withdraw Request"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <ApplyLeaveModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={loadData}
      />
    </PageContainer>
    </ProtectedRoute>
  );
}
