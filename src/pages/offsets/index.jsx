import React, { useState, useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Plus, Trash2, CalendarDays, Filter, ShieldCheck } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import PageShell from '../../components/ui/PageShell';
import EmptyState from '../../components/ui/EmptyState';
import FilterBar from '../../components/ui/FilterBar';
import { FilterSelect } from '../../components/ui/FilterDropdown';
import Spinner from '../../components/ui/Spinner';
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

const TYPE_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All types' },
  { value: 'OFFSET', label: 'Offset' },
  { value: 'SIL', label: 'SIL' },
  { value: 'OVERTIME', label: 'Overtime' },
  { value: 'UNDERTIME', label: 'Undertime' },
];

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

  // The balances sit beside Apply Leave / OT: they are what the person checks
  // before applying, on either tab. A zero balance reads muted, not alarming.
  const balances = (
    <dl className="flex items-center gap-6">
      {[
        { label: 'Offset balance', hours: offsetBalance },
        { label: 'SIL balance', hours: silBalance },
      ].map(({ label, hours }) => {
        const value = parseFloat(hours) || 0;
        return (
          <div key={label} className="flex flex-col">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className={`font-mono text-sm font-semibold tabular-nums ${value > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              {value.toFixed(1)}
              <span className="ml-1 font-sans text-xs font-medium text-muted-foreground">hrs</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );

  return (
    <ProtectedRoute>
      <PageShell
        title="My Requests"
        description="Track every leave, offset, overtime and undertime request you've filed, and see where each one stands."
        action={
          <>
            {balances}
            <span aria-hidden="true" className="hidden h-8 w-px bg-border sm:block" />
            <Button onClick={() => setIsApplyModalOpen(true)}>
              <Plus size={16} />
              Apply Leave / OT
            </Button>
          </>
        }
        tabs={
          <TabGroup
            variant="underline"
            tabs={[
              { value: 'requests', label: 'My Requests', badge: requests.length },
              { value: 'calendar', label: 'Calendar' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />
        }
        toolbar={
          activeTab === 'requests' && (
            <FilterBar
              chips={
                <FilterSelect
                  icon={Filter}
                  label="Type"
                  options={TYPE_FILTER_OPTIONS}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  className="h-9 w-auto gap-2 px-2.5"
                  wrapperClassName="w-auto shrink-0"
                />
              }
              hasActiveFilters={typeFilter !== 'ALL'}
              onClearAll={() => setTypeFilter('ALL')}
            />
          )
        }
      >
        {/* Date Picker Overlay */}
        <FloatingMonthPicker
          selectedRange={dateRange}
          onChange={setDateRange}
        />

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
          loadingHistory ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
              <Spinner size="sm" />
              <span className="text-sm font-bold">Loading requests…</span>
            </div>
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No requests found"
              description="You haven't filed anything in the selected month that matches this filter."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card animate-in fade-in duration-300">
              <Table className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>Applied On</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Files</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((req) => {
                    const stage = deriveRequestStage(req);
                    return (
                      <TableRow key={req.type + '-' + req.id}>
                        <TableCell className="text-xs text-muted-foreground font-medium">
                          {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </TableCell>
                        <TableCell>
                          <span className={`font-black uppercase tracking-wider px-2 py-0.5 rounded text-[10px] border ${REQUEST_TYPE_META[req.type].badgeClass}`}>
                            {REQUEST_TYPE_META[req.type].label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-bold text-foreground">
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
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell>
                          {req.attachments?.length ? (
                            <AttachmentList attachments={req.attachments} compact />
                          ) : (
                            <span className="text-xs text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge theme={getRequestStageTheme(stage.tone)} label={stage.label} />
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-muted-foreground truncate max-w-[200px]" title={stage.note || ''}>
                          {stage.note || '-'}
                        </TableCell>
                        <TableCell className="text-right flex items-center justify-end gap-2">
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleWithdraw(req)}
                              className="bg-destructive/10 hover:bg-destructive/20 text-destructive border border-transparent hover:border-destructive/20"
                              title="Withdraw Request"
                              aria-label="Withdraw Request"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )
        )}
      </PageShell>

      <ApplyLeaveModal
        isOpen={isApplyModalOpen}
        onClose={() => setIsApplyModalOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['employeeLeaves'] })}
      />
    </ProtectedRoute>
  );
}
