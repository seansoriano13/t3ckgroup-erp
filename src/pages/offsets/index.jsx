import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Clock, Calendar, PlusCircle, CheckCircle2, XCircle, Trash2, CalendarDays } from 'lucide-react';
import PageContainer from '../../components/ui/PageContainer';
import PageHeader from '../../components/ui/PageHeader';
import TabGroup from '../../components/ui/TabGroup';
import { Button } from '@/components/ui/button';
import FloatingMonthPicker from '../../components/FloatingMonthPicker';
import NotionOffsetCalendar from '../../components/hr/NotionOffsetCalendar';
import ApplyOffsetModal from '../../components/offsets/ApplyOffsetModal';
import { confirmDeleteToast } from '../../components/ui/CustomToast';

export default function EmployeeOffsetsPage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(user?.offset_hours_balance || 0);
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar', 'overtime', 'leave'
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);

  // Date Range State (for FloatingMonthPicker)
  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: new Date().toISOString().slice(0, 7) + '-01',
    endDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10),
  });

  const [overtimeHistory, setOvertimeHistory] = useState([]);
  const [leaveHistory, setLeaveHistory] = useState([]);
  const [globalApprovedLeaves, setGlobalApprovedLeaves] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user, dateRange]);

  const loadData = async () => {
    setLoadingHistory(true);
    try {
      const [otData, lvData, allLeavesData] = await Promise.all([
        offsetService.getMyOvertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyOffsetLeaves(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getAllOffsetLeaves(dateRange.startDate, dateRange.endDate), // Filtered by RLS for standard users
      ]);
      setOvertimeHistory(otData);
      setLeaveHistory(lvData);
      setGlobalApprovedLeaves(allLeavesData.filter(l => l.status === 'APPROVED'));

      // Also refresh the user's latest balance
      const { data: empData } = await supabase
        .from('employees')
        .select('offset_hours_balance')
        .eq('id', user.id)
        .single();

      if (empData) {
        setBalance(empData.offset_hours_balance);
      }
    } catch (err) {
      console.error('Failed to load offset data:', err);
      toast.error('Could not load offset history or calendar.');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleWithdrawOvertime = (id) => {
    confirmDeleteToast(
      'Withdraw Overtime Request',
      'Are you sure you want to withdraw this overtime request? This cannot be undone.',
      async () => {
        try {
          await offsetService.withdrawOvertimeRequest({ requestId: id, employeeId: user.id });
          toast.success('Overtime request withdrawn successfully.');
          loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  };

  const handleWithdrawLeave = (id, status) => {
    confirmDeleteToast(
      'Withdraw Leave Request',
      'Are you sure you want to withdraw this offset leave request? This cannot be undone.',
      async () => {
        try {
          await offsetService.withdrawOffsetLeave({ leaveId: id, employeeId: user.id });
          toast.success('Leave request withdrawn successfully.');
          loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  };

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

  return (
    <PageContainer className="pt-4 space-y-6 relative">

      {/* Date Picker Overlay */}
      <FloatingMonthPicker
        selectedRange={dateRange}
        onChange={setDateRange}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between p-6 bg-card border border-border rounded-2xl shadow-sm gap-4">
        <div className="flex-1">
          <PageHeader
            title="Offset / Overtime Request"
            description="Manage your offset balance and request additional hours."
          />
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
          <div className="bg-muted border border-border px-5 py-3 rounded-xl flex flex-col justify-center">
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Available Offset Hours</p>
            <p className="text-2xl font-black text-primary">{parseFloat(balance).toFixed(1)} <span className="text-xs font-medium text-muted-foreground">hrs</span></p>
          </div>
          <Button
            onClick={() => setIsApplyModalOpen(true)}
            className="h-full min-h-[64px] px-6 rounded-xl font-bold shadow-md shadow-primary/20 flex items-center gap-2 cursor-pointer"
          >
            <PlusCircle size={18} />
            Apply Offset / Overtime
          </Button>
        </div>
      </div>

      {/* History Tabs & Table */}
      <div className="space-y-4 pt-4">
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

        {activeTab === 'calendar' && (
          <div className="animate-in fade-in duration-300">
            <NotionOffsetCalendar
              approvedLeaves={globalApprovedLeaves}
              currentUserId={user?.id}
              onWithdrawLeave={handleWithdrawLeave}
              targetDate={dateRange.startDate}
            />
          </div>
        )}

        {(activeTab === 'overtime' || activeTab === 'leave') && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                  <th className="p-4">{activeTab === 'overtime' ? 'Date Worked' : 'Leave Date'}</th>
                  <th className="p-4">Hours</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">HR Remarks</th>
                  <th className="p-4 w-[80px]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingHistory ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-muted-foreground font-bold italic text-sm">
                      Loading...
                    </td>
                  </tr>
                ) : activeTab === 'overtime' ? (
                  overtimeHistory.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="p-8 text-center text-muted-foreground font-bold italic text-sm">
                        No overtime applications found in this period.
                      </td>
                    </tr>
                  ) : (
                    overtimeHistory.map((req) => (
                      <tr key={req.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-4 text-sm font-bold text-foreground">
                          {new Date(req.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                        </td>
                        <td className="p-4 text-sm font-semibold text-muted-foreground">{req.hours} hrs</td>
                        <td className="p-4">{getStatusBadge(req.status)}</td>
                        <td className="p-4 text-sm text-muted-foreground font-medium">{req.hr_notes || '—'}</td>
                        <td className="p-4">
                          {req.status === 'PENDING' && (
                            <button
                              onClick={() => handleWithdrawOvertime(req.id)}
                              className="text-red-11 hover:text-red-12 p-1.5 hover:bg-red-3 rounded-lg transition-colors cursor-pointer"
                              title="Withdraw Request"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )
                ) : leaveHistory.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="p-8 text-center text-muted-foreground font-bold italic text-sm">
                      No offset leave applications found in this period.
                    </td>
                  </tr>
                ) : (
                  leaveHistory.map((leave) => (
                    <tr key={leave.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4 text-sm font-bold text-foreground">
                        {new Date(leave.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                      </td>
                      <td className="p-4 text-sm font-semibold text-muted-foreground">{leave.hours} hrs</td>
                      <td className="p-4">{getStatusBadge(leave.status)}</td>
                      <td className="p-4 text-sm text-muted-foreground font-medium">{leave.hr_notes || '—'}</td>
                      <td className="p-4">
                        {(leave.status === 'PENDING' || leave.status === 'APPROVED') && (
                          <button
                            onClick={() => handleWithdrawLeave(leave.id, leave.status)}
                            className="text-red-11 hover:text-red-12 p-1.5 hover:bg-red-3 rounded-lg transition-colors cursor-pointer"
                            title={leave.status === 'APPROVED' ? "Withdraw and Refund Hours" : "Withdraw Request"}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Apply Modal */}
      <ApplyOffsetModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={loadData}
      />
    </PageContainer>
  );
}
