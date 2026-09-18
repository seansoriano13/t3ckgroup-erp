import React, { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Clock, PlusCircle, Trash2, CalendarDays, Filter, ShieldCheck } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import PageContainer from '../../components/ui/PageContainer';
import PageHeader from '../../components/ui/PageHeader';
import TabGroup from '../../components/ui/TabGroup';
import StatusBadge from '../../components/StatusBadge';
import { Button } from '@/components/ui/button';
import FloatingMonthPicker from '../../components/FloatingMonthPicker';
import NotionLeaveCalendar from '../../components/hr/NotionLeaveCalendar';
import ApplyLeaveModal from '../../components/offsets/ApplyLeaveModal';
import { confirmDeleteToast } from '../../components/ui/CustomToast';
import { AttachmentList } from '../../components/ui/Attachments';
import { getMonthBoundaries } from '../../utils/dateUtils';
import { formatWindow } from '../../utils/time';
import { mergeRequestRows } from '../../utils/mergeRequests';
import { deriveRequestStage } from '../../utils/requestStage';
import { getRequestStageTheme } from '../../constants/status';

// One entry per request type instead of parallel label/class/withdraw maps —
// adding a fifth type (or changing how one withdraws) touches this table only.
const REQUEST_TYPE_META = {
  OFFSET: {
    label: 'Offset',
    badgeClass: 'bg-blue-2 text-blue-11 border-blue-6',
    withdraw: (req, employeeId) => offsetService.withdrawOffsetLeave({ leaveId: req.id, employeeId }),
  },
  SIL: {
    label: 'SIL',
    badgeClass: 'bg-green-2 text-green-11 border-green-6',
    withdraw: (req, employeeId) => silService.cancelMySilLeave({ leaveId: req.id, employeeId }),
  },
  OVERTIME: {
    label: 'Overtime',
    badgeClass: 'bg-violet-2 text-violet-11 border-violet-6',
    withdraw: (req, employeeId) => offsetService.withdrawOvertimeRequest({ requestId: req.id, employeeId }),
  },
  UNDERTIME: {
    label: 'Undertime',
    badgeClass: 'bg-amber-2 text-amber-11 border-amber-6',
    withdraw: (req, employeeId) => offsetService.withdrawUndertimeRequest({ requestId: req.id, employeeId }),
  },
};

export default function EmployeeLeavesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('requests'); // 'requests', 'calendar'
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL'); // 'ALL', 'OFFSET', 'SIL', 'OVERTIME', 'UNDERTIME'

  // Date Range State (for FloatingMonthPicker)
  const currentDate = new Date();
  const currentMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const initialBoundaries = getMonthBoundaries(currentMonthStr);

  const [dateRange, setDateRange] = useState({
    mode: 'MONTHLY',
    startDate: initialBoundaries.startDate,
    endDate: initialBoundaries.endDate,
  });

  const { data, isLoading: loadingHistory } = useQuery({
    queryKey: ['employeeLeaves', user?.id, dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const [
        otData,
        offsetLvData,
        allOffsetLeavesData,
        silLvData,
        allSilLeavesData,
        pendingOtData,
        pendingOffsetData,
        pendingSilData,
        utData,
        pendingUtData,
        empDataRes
      ] = await Promise.all([
        offsetService.getMyOvertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyOffsetLeaves(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getCalendarOffsetLeaves(dateRange.startDate, dateRange.endDate), // Calendar projection
        silService.getMySilLeaves(user.id, dateRange.startDate, dateRange.endDate),
        silService.getCalendarSilLeaves(dateRange.startDate, dateRange.endDate), // Calendar projection
        offsetService.getMyPendingOvertimeRequests(user.id),
        offsetService.getMyPendingOffsetLeaves(user.id),
        silService.getMyPendingSilLeaves(user.id),
        offsetService.getMyUndertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyPendingUndertimeRequests(user.id),
        supabase.from('employees').select('offset_hours_balance, sil_hours_balance').eq('id', user.id).single()
      ]);

      // Pending requests are fetched unbounded by date, so an application
      // filed outside the selected month still shows while it is waiting.
      const requests = mergeRequestRows({
        OFFSET: [...offsetLvData, ...pendingOffsetData],
        SIL: [...silLvData, ...pendingSilData],
        OVERTIME: [...otData, ...pendingOtData],
        UNDERTIME: [...utData, ...pendingUtData],
      });

      const approvedOffset = allOffsetLeavesData.filter(l => l.status === 'APPROVED').map(l => ({ ...l, type: 'OFFSET' }));
      const approvedSil = allSilLeavesData.filter(l => l.status === 'APPROVED').map(l => ({ ...l, type: 'SIL' }));

      return {
        requests,
        globalApprovedLeaves: [...approvedOffset, ...approvedSil],
        offsetBalance: empDataRes.data?.offset_hours_balance ?? user?.offset_hours_balance ?? 0,
        silBalance: empDataRes.data?.sil_hours_balance ?? user?.sil_hours_balance ?? 0,
      };
    },
    enabled: Boolean(user?.id)
  });

  const {
    requests = [],
    globalApprovedLeaves = [],
    offsetBalance = user?.offset_hours_balance || 0,
    silBalance = user?.sil_hours_balance || 0,
  } = data || {};

  const handleWithdraw = useCallback((req) => {
    const label = REQUEST_TYPE_META[req.type]?.label || 'Request';
    confirmDeleteToast(
      `Withdraw ${label} Request`,
      `Are you sure you want to withdraw this ${label.toLowerCase()} request? This cannot be undone.`,
      async () => {
        try {
          await REQUEST_TYPE_META[req.type].withdraw(req, user?.id);
          toast.success(`${label} request withdrawn successfully.`);
          queryClient.invalidateQueries({ queryKey: ['employeeLeaves'] });
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  }, [user?.id, queryClient]);

  // NotionLeaveCalendar calls back with (id, status, type) for its own withdraw affordance.
  const handleWithdrawFromCalendar = useCallback((id, status, type) => {
    handleWithdraw({ id, status, type });
  }, [handleWithdraw]);

  const filteredRequests = useMemo(() => {
    if (typeFilter === 'ALL') return requests;
    return requests.filter(r => r.type === typeFilter);
  }, [requests, typeFilter]);

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
          title="My Requests"
          description="Track every leave, offset, overtime and undertime request you've filed, and see where each one stands."
        />
      </div>

      {/* History Tabs & Actions */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <TabGroup
            variant="pill"
            tabs={[
              { value: 'requests', label: `My Requests (${requests.length})` },
              { value: 'calendar', label: `Calendar` },
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
              onWithdrawLeave={handleWithdrawFromCalendar}
              targetDate={dateRange.startDate}
            />
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300 flex flex-col">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
              <h3 className="font-black text-sm text-foreground">All Requests</h3>
              <div className="flex items-center space-x-2">
                <Filter size={14} className="text-muted-foreground" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-card border border-border rounded-lg text-xs font-bold px-2 py-1 outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer text-foreground"
                >
                  <option value="ALL">All Types</option>
                  <option value="OFFSET">Offset</option>
                  <option value="SIL">SIL</option>
                  <option value="OVERTIME">Overtime</option>
                  <option value="UNDERTIME">Undertime</option>
                </select>
              </div>
            </div>

            {loadingHistory ? (
              <div className="p-8 text-center text-muted-foreground text-sm font-bold flex flex-col items-center gap-3">
                <Clock className="animate-spin" size={24} />
                Loading requests...
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-center bg-muted/20 border-t border-border">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4 text-muted-foreground/50">
                  <CalendarDays size={32} />
                </div>
                <h3 className="text-lg font-black text-foreground mb-1 tracking-tight">No requests found</h3>
                <p className="text-sm font-semibold text-muted-foreground max-w-sm">
                  You haven't filed anything in the selected month that matches this filter.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                      <th className="p-4">Applied On</th>
                      <th className="p-4">Type</th>
                      <th className="p-4">Date</th>
                      <th className="p-4">Hours</th>
                      <th className="p-4">Files</th>
                      <th className="p-4">Stage</th>
                      <th className="p-4">Note</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRequests.map((req) => {
                      const stage = deriveRequestStage(req);
                      return (
                        <tr key={req.type + '-' + req.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-4 text-xs text-muted-foreground font-medium">
                            {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td className="p-4">
                            <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${REQUEST_TYPE_META[req.type].badgeClass}`}>
                              {REQUEST_TYPE_META[req.type].label}
                            </span>
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
                            <StatusBadge theme={getRequestStageTheme(stage.tone)} label={stage.label} />
                          </td>
                          <td className="p-4 text-xs font-semibold text-muted-foreground truncate max-w-[200px]" title={stage.note || ''}>
                            {stage.note || '-'}
                          </td>
                          <td className="p-4 text-right flex items-center justify-end gap-2">
                            {req.verification_token && (
                              <Link
                                to={`/verify/${req.verification_token}`}
                                target="_blank"
                                className="p-2 text-primary/70 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors cursor-pointer"
                                title="View Verified Form"
                              >
                                <ShieldCheck size={18} />
                              </Link>
                            )}
                            {req.status === 'PENDING' && (
                              <button
                                onClick={() => handleWithdraw(req)}
                                className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-all inline-block border border-transparent hover:border-destructive/20 cursor-pointer"
                                title="Withdraw Request"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employeeLeaves'] })}
      />
    </PageContainer>
    </ProtectedRoute>
  );
}
