import PageLoading from "@/components/ui/PageLoading";
import React, { useState, useMemo, useCallback } from 'react';
import QueryError from "@/components/ui/QueryError";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { lwopService } from '../../services/lwopService';
import { silService } from '../../services/silService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Plus, CalendarDays, Filter } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import PageShell from '../../components/ui/PageShell';
import EmptyState from '../../components/ui/EmptyState';
import FilterBar from '../../components/ui/FilterBar';
import { FilterSelect } from '../../components/ui/FilterDropdown';
import TabGroup from '../../components/ui/TabGroup';
import { Button } from '@/components/ui/button';
import FloatingMonthPicker from '../../components/FloatingMonthPicker';
import Calendar from '@/components/calendar/Calendar';
import { TIME_OFF_OVERTIME_LAYERS } from '@/components/calendar/entryKinds.jsx';
import ApplyLeaveModal from '../../components/offsets/ApplyLeaveModal';
import { confirmDeleteToast } from '../../components/ui/CustomToast';
import { getMonthBoundaries } from '../../utils/dateUtils';
import { mergeRequestRows } from '../../utils/mergeRequests';
import RequestsTable from './_components/RequestsTable';
import { REQUEST_TYPE_BADGE } from './_components/requestTypes';
import { CAPTION_BASE } from "@/lib/captionStyle";

// How each request type withdraws; its label and badge live beside the table.
const REQUEST_WITHDRAW = {
  OFFSET: (req, employeeId) => offsetService.withdrawOffsetLeave({ leaveId: req.id, employeeId }),
  SIL: (req, employeeId) => silService.cancelMySilLeave({ leaveId: req.id, employeeId }),
  LWOP: (req, employeeId) => lwopService.cancelMyLwopLeave({ leaveId: req.id, employeeId }),
  OVERTIME: (req, employeeId) => offsetService.withdrawOvertimeRequest({ requestId: req.id, employeeId }),
  UNDERTIME: (req, employeeId) => offsetService.withdrawUndertimeRequest({ requestId: req.id, employeeId }),
};

const TYPE_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All types' },
  { value: 'OFFSET', label: 'Offset' },
  { value: 'SIL', label: 'SIL' },
  { value: 'LWOP', label: 'LWOP' },
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

  const { data, isLoading: loadingHistory, isError, refetch } = useQuery({
    queryKey: ['employeeLeaves', user?.id, dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const [
        otData,
        offsetLvData,
        silLvData,
        pendingOtData,
        pendingOffsetData,
        pendingSilData,
        lwopLvData,
        pendingLwopData,
        utData,
        pendingUtData,
        empDataRes
      ] = await Promise.all([
        offsetService.getMyOvertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyOffsetLeaves(user.id, dateRange.startDate, dateRange.endDate),
        silService.getMySilLeaves(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyPendingOvertimeRequests(user.id),
        offsetService.getMyPendingOffsetLeaves(user.id),
        silService.getMyPendingSilLeaves(user.id),
        lwopService.getMyLwopLeaves(user.id, dateRange.startDate, dateRange.endDate),
        lwopService.getMyPendingLwopLeaves(user.id),
        offsetService.getMyUndertimeRequests(user.id, dateRange.startDate, dateRange.endDate),
        offsetService.getMyPendingUndertimeRequests(user.id),
        supabase.from('employees').select('offset_hours_balance, sil_hours_balance').eq('id', user.id).single()
      ]);

      // Pending requests are fetched unbounded by date, so an application
      // filed outside the selected month still shows while it is waiting.
      const requests = mergeRequestRows({
        OFFSET: [...offsetLvData, ...pendingOffsetData],
        SIL: [...silLvData, ...pendingSilData],
        LWOP: [...lwopLvData, ...pendingLwopData],
        OVERTIME: [...otData, ...pendingOtData],
        UNDERTIME: [...utData, ...pendingUtData],
      });

      return {
        requests,
        offsetBalance: empDataRes.data?.offset_hours_balance ?? user?.offset_hours_balance ?? 0,
        silBalance: empDataRes.data?.sil_hours_balance ?? user?.sil_hours_balance ?? 0,
      };
    },
    enabled: Boolean(user?.id)
  });

  const {
    requests = [],
    offsetBalance = user?.offset_hours_balance || 0,
    silBalance = user?.sil_hours_balance || 0,
  } = data || {};

  const handleWithdraw = useCallback((req) => {
    const label = REQUEST_TYPE_BADGE[req.type]?.label || 'Request';
    confirmDeleteToast(
      `Withdraw ${label} Request`,
      `Are you sure you want to withdraw this ${label.toLowerCase()} request? This cannot be undone.`,
      async () => {
        try {
          await REQUEST_WITHDRAW[req.type](req, user?.id);
          toast.success(`${label} request withdrawn successfully.`);
          queryClient.invalidateQueries({ queryKey: ['employeeLeaves'] });
          queryClient.invalidateQueries({ queryKey: ['calendar-entries'] });
        } catch (err) {
          toast.error(err.message || 'Failed to withdraw request.');
        }
      }
    );
  }, [user?.id, queryClient]);

  // The Calendar's detail panel offers Withdraw on the viewer's own upcoming Time Off.
  const handleWithdrawFromCalendar = useCallback((entry) => {
    handleWithdraw({ id: entry.id, status: entry.status, type: entry.kind });
  }, [handleWithdraw]);

  const filteredRequests = useMemo(() => {
    if (typeFilter === 'ALL') return requests;
    return requests.filter(r => r.type === typeFilter);
  }, [requests, typeFilter]);

  // The balances sit beside File Time Off / Overtime: they are what the person checks
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
            <dt className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>{label}</dt>
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
            <FloatingMonthPicker inline selectedRange={dateRange} onChange={setDateRange} />
            {balances}
            <span aria-hidden="true" className="hidden h-8 w-px bg-border sm:block" />
            <Button onClick={() => setIsApplyModalOpen(true)}>
              <Plus size={16} />
              File Time Off / Overtime
            </Button>
          </>
        }
        tabs={
          <TabGroup
            variant="underline"
            tabs={[
              { value: 'requests', label: 'Requests', badge: requests.length },
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

        {activeTab === 'calendar' && (
          <div className="animate-in fade-in duration-300">
            <Calendar presetLayers={TIME_OFF_OVERTIME_LAYERS} onWithdraw={handleWithdrawFromCalendar} />
          </div>
        )}

        {activeTab === 'requests' && (
          isError ? (
            <QueryError title="Your requests could not be loaded." onRetry={refetch} />
          ) : loadingHistory ? (
            <PageLoading label="requests" />
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No requests found"
              description="You haven't filed anything in the selected month that matches this filter."
            />
          ) : (
            <RequestsTable rows={filteredRequests} onWithdraw={handleWithdraw} />
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
