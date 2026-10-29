import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { lwopService } from '../../services/lwopService';
import { hrSettingsService } from '../../services/hrSettingsService';
import { employeeService } from '../../services/employeeService';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X, Calendar, PlusCircle, Clock } from 'lucide-react';
import TabGroup from '../ui/TabGroup';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { AttachmentField } from '../ui/Attachments';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { safeDeriveHours } from '../../utils/time';
import { applyLunchDeduction, previewLeaveHours, computeAvailableHours, deriveUndertimeHours, assertNotWeekend } from '../../services/leaveRules';
import { enumerateDateRange } from '../../utils/dateUtils';
import { dayShiftService } from '../../services/dayShiftService';
import { DEFAULT_DAY_SHIFT_CONFIG, getShiftForDate } from '../../services/dayShift';
import HeadSelectField from './HeadSelectField';
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";
const DEFAULT_DAY_HOURS = 8;

/**
 * Lets an employee cover several consecutive days in one submission (ticket
 * #63) instead of applying day by day. Each day defaults to 8 hours and is
 * individually editable, so a half-day inside the range stays expressible;
 * the actual grouping into one `leave_group_id` happens server-side.
 */
function RangeDayEditor({ startDate, endDate, onStartDateChange, onEndDateChange, dayHours, onDayHoursChange }) {
  const days = enumerateDateRange(startDate, endDate);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldBox label="From" className="block mb-1.5" />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            containerClassName="w-full" className="font-semibold"
            required
          />
        </div>
        <div>
          <FieldBox label="To" className="block mb-1.5" />
          <Input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            containerClassName="w-full" className="font-semibold"
            required
          />
        </div>
      </div>

      {days.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {days.map((date) => {
            const rawHours = parseFloat(dayHours[date] ?? DEFAULT_DAY_HOURS) || 0;
            const netHours = applyLunchDeduction(rawHours);
            return (
              <div key={date} className="flex items-center justify-between gap-3 bg-muted/60 border border-border rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-foreground">
                  {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={dayHours[date] ?? DEFAULT_DAY_HOURS}
                    onChange={(e) => onDayHoursChange(date, e.target.value)}
                    containerClassName="w-16 shrink-0"
                    className="h-auto px-2 py-1 rounded-md text-xs font-bold text-right"
                  />
                  <span className="text-label font-semibold text-muted-foreground uppercase">hrs</span>
                  {netHours !== rawHours && (
                    <span className="text-[10px] font-semibold text-muted-foreground">→ {netHours} net</span>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-0.5">
            {days.length} day{days.length > 1 ? 's' : ''} · {days.reduce((sum, d) => sum + applyLunchDeduction(parseFloat(dayHours[d] ?? DEFAULT_DAY_HOURS) || 0), 0)} hrs total (1 hr lunch deducted per day of 5+ hrs)
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One modal, two entry points: Self-Service employees file under their own
 * identity, HR files on an employee's behalf via `showEmployeeSelector`
 * (issue #107 — the two used to be separate 700-line forks that drifted).
 */
export default function ApplyLeaveModal({ isOpen, onClose, onSuccess, showEmployeeSelector = false }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overtime'); // 'overtime' | 'offset' | 'sil' | 'undertime'
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

  // Overtime State
  const [otDate, setOtDate] = useState('');
  const [otStartTime, setOtStartTime] = useState('');
  const [otEndTime, setOtEndTime] = useState('');
  const [otReason, setOtReason] = useState('');
  const [otHeadId, setOtHeadId] = useState('');
  const [otSubmitting, setOtSubmitting] = useState(false);
  const otFiles = useFileAttachments();

  // Offset Leave State
  const [offsetApplyMode, setOffsetApplyMode] = useState('single'); // 'single' | 'range'
  const [offsetDate, setOffsetDate] = useState('');
  const [offsetStartTime, setOffsetStartTime] = useState('');
  const [offsetEndTime, setOffsetEndTime] = useState('');
  const [offsetRangeStart, setOffsetRangeStart] = useState('');
  const [offsetRangeEnd, setOffsetRangeEnd] = useState('');
  const [offsetDayHours, setOffsetDayHours] = useState({});
  const [offsetReason, setOffsetReason] = useState('');
  const [offsetHeadId, setOffsetHeadId] = useState('');
  const [offsetSubmitting, setOffsetSubmitting] = useState(false);
  const offsetFiles = useFileAttachments();

  // SIL Leave State
  const [leavePay, setLeavePay] = useState('sil'); // 'sil' (with pay) | 'lwop' (without pay) — the Leave tab files either
  const [silApplyMode, setSilApplyMode] = useState('single'); // 'single' | 'range'
  const [silDate, setSilDate] = useState('');
  const [silCategoryId, setSilCategoryId] = useState('');
  const [silStartTime, setSilStartTime] = useState('');
  const [silEndTime, setSilEndTime] = useState('');
  const [silRangeStart, setSilRangeStart] = useState('');
  const [silRangeEnd, setSilRangeEnd] = useState('');
  const [silDayHours, setSilDayHours] = useState({});
  const [silReason, setSilReason] = useState('');
  const [silHeadId, setSilHeadId] = useState('');
  const [recordAbsent, setRecordAbsent] = useState(false); // HR only: save the LWOP as already approved (#620)
  const [silSubmitting, setSilSubmitting] = useState(false);
  const silFiles = useFileAttachments();

  // Undertime State
  const [utDate, setUtDate] = useState('');
  const [utOriginalStart, setUtOriginalStart] = useState('');
  const [utOriginalEnd, setUtOriginalEnd] = useState('');
  const [utActualStart, setUtActualStart] = useState('');
  const [utActualEnd, setUtActualEnd] = useState('');
  const [utReason, setUtReason] = useState('');
  const [utHeadId, setUtHeadId] = useState('');
  const [utSubmitting, setUtSubmitting] = useState(false);
  const utFiles = useFileAttachments();

  const currentOtHours = previewLeaveHours(otStartTime, otEndTime, { allowOvernight: true });
  const currentOffsetHoursRaw = safeDeriveHours(offsetStartTime, offsetEndTime, false);
  const currentOffsetHours = previewLeaveHours(offsetStartTime, offsetEndTime);
  const currentSilHoursRaw = safeDeriveHours(silStartTime, silEndTime, false);
  const currentSilHours = previewLeaveHours(silStartTime, silEndTime);
  // deriveUndertimeHours throws on a backwards window (via deriveHours) — the
  // right behavior for the submit path, but this live preview renders on every
  // keystroke while the user is still mid-edit, so a half-typed end time before
  // its start must not take the render down (same reasoning as safeDeriveHours).
  let currentUtHours = 0;
  if (utOriginalStart && utOriginalEnd && utActualStart && utActualEnd) {
    try {
      currentUtHours = deriveUndertimeHours({ startTime: utOriginalStart, endTime: utOriginalEnd }, { startTime: utActualStart, endTime: utActualEnd });
    } catch {
      currentUtHours = 0;
    }
  }

  const { data: categories = [] } = useQuery({
    queryKey: ['activeLeaveCategories'],
    queryFn: () => hrSettingsService.getLeaveCategories(false),
  });

  const { data: dayShiftConfig = DEFAULT_DAY_SHIFT_CONFIG } = useQuery({
    queryKey: ['dayShiftConfig'],
    queryFn: () => dayShiftService.getDayShiftConfig(),
    initialData: DEFAULT_DAY_SHIFT_CONFIG,
    staleTime: 5 * 60 * 1000,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['hrEmployeesList'],
    enabled: showEmployeeSelector,
    queryFn: async () => {
      const allEmps = await employeeService.getAllEmployees();
      return allEmps.sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const selectedEmployeeName = useMemo(() => {
    return employees.find((e) => e.id === selectedEmployeeId)?.name || 'Unknown';
  }, [employees, selectedEmployeeId]);

  const canRecordAbsent = showEmployeeSelector && leavePay === 'lwop';
  const employeeId = showEmployeeSelector ? selectedEmployeeId : user.id;
  const employeeName = showEmployeeSelector ? selectedEmployeeName : user.name;

  const selectedEmployee = useMemo(
    () => (showEmployeeSelector ? employees.find((e) => e.id === selectedEmployeeId) : user),
    [showEmployeeSelector, employees, selectedEmployeeId, user],
  );

  // What the employee can still commit — the balance minus what their own
  // pending applications already claim, not the raw balance (issue #106).
  const { data: pendingOffsetHours = 0 } = useQuery({
    queryKey: ['pendingOffsetHours', employeeId],
    queryFn: () => offsetService.getPendingOffsetHours(employeeId),
    enabled: !!employeeId,
  });
  const { data: pendingSilHours = 0 } = useQuery({
    queryKey: ['pendingSilHours', employeeId],
    queryFn: () => silService.getPendingSilHours(employeeId),
    enabled: !!employeeId,
  });
  const availableOffsetHours = computeAvailableHours(selectedEmployee?.offset_hours_balance, pendingOffsetHours);
  const availableSilHours = computeAvailableHours(selectedEmployee?.sil_hours_balance, pendingSilHours);

  useEffect(() => {
    if (silDate && silApplyMode === 'single') {
      const shift = getShiftForDate(silDate, dayShiftConfig);
      if (shift.isWorkingDay) {
        if (!silStartTime) setSilStartTime(shift.startTime);
        if (!silEndTime) setSilEndTime(shift.endTime);
      }
    }
  }, [silDate, silApplyMode, dayShiftConfig]);

  // Pre-fills the original (scheduled) window from the day-shift config for
  // the chosen weekday — stays editable, never locked (issue #147).
  useEffect(() => {
    if (utDate) {
      const shift = getShiftForDate(utDate, dayShiftConfig);
      if (shift.isWorkingDay) {
        if (!utOriginalStart) setUtOriginalStart(shift.startTime);
        if (!utOriginalEnd) setUtOriginalEnd(shift.endTime);
      }
    }
  }, [utDate, dayShiftConfig]);

  if (!isOpen) return null;

  const handleApplyOvertime = async (e) => {
    e.preventDefault();
    if (!employeeId || !otHeadId) {
      toast.error('Please fill in all fields.');
      return;
    }
    if (!otDate || !otStartTime || !otEndTime || !otReason) {
      toast.error('Please fill in all fields.');
      return;
    }

    setOtSubmitting(true);
    try {
      const attachments = await otFiles.upload();
      await offsetService.applyOvertime({
        employeeId,
        date: otDate,
        startTime: otStartTime,
        endTime: otEndTime,
        reason: otReason,
        employeeName,
        attachments,
        headId: otHeadId,
      });
      toast.success('Overtime application submitted!');
      setOtDate('');
      setOtStartTime('');
      setOtEndTime('');
      setOtReason('');
      setOtHeadId('');
      otFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit overtime application.');
    } finally {
      setOtSubmitting(false);
    }
  };

  const handleApplyOffsetLeave = async (e) => {
    e.preventDefault();
    if (!employeeId || !offsetHeadId) {
      toast.error('Please fill in all fields.');
      return;
    }

    if (offsetApplyMode === 'range') {
      const days = enumerateDateRange(offsetRangeStart, offsetRangeEnd);
      if (days.length === 0 || !offsetReason) {
        toast.error('Please fill in all fields.');
        return;
      }

      setOffsetSubmitting(true);
      try {
        const attachments = await offsetFiles.upload();
        await offsetService.applyOffsetLeaveRange({
          employeeId,
          days: days.map((date) => ({ date, hours: parseFloat(offsetDayHours[date] ?? DEFAULT_DAY_HOURS) })),
          reason: offsetReason,
          employeeName,
          attachments,
          headId: offsetHeadId,
        });
        toast.success(`Offset application submitted for ${days.length} day${days.length > 1 ? 's' : ''}!`);
        setOffsetRangeStart('');
        setOffsetRangeEnd('');
        setOffsetDayHours({});
        setOffsetReason('');
        setOffsetHeadId('');
        offsetFiles.clear();
        onSuccess?.();
        onClose();
      } catch (err) {
        toast.error(err.message || 'Failed to submit Offset.');
      } finally {
        setOffsetSubmitting(false);
      }
      return;
    }

    if (!offsetDate || !offsetStartTime || !offsetEndTime || !offsetReason) {
      toast.error('Please fill in all fields.');
      return;
    }

    setOffsetSubmitting(true);
    try {
      const attachments = await offsetFiles.upload();
      await offsetService.applyOffsetLeave({
        employeeId,
        date: offsetDate,
        startTime: offsetStartTime,
        endTime: offsetEndTime,
        reason: offsetReason,
        employeeName,
        attachments,
        headId: offsetHeadId,
      });
      toast.success('Offset application submitted!');
      setOffsetDate('');
      setOffsetStartTime('');
      setOffsetEndTime('');
      setOffsetReason('');
      setOffsetHeadId('');
      offsetFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit Offset.');
    } finally {
      setOffsetSubmitting(false);
    }
  };

  const handleApplySilLeave = async (e) => {
    e.preventDefault();
    const isLwop = leavePay === 'lwop';
    const recording = canRecordAbsent && recordAbsent;
    if (!employeeId || (!silHeadId && !recording)) {
      toast.error('Please fill in all fields.');
      return;
    }

    const leaveLabel = isLwop ? 'LWOP' : 'SIL leave';
    const filedRange = isLwop ? lwopService.applyLwopLeaveRange : silService.applySilLeaveRange;
    const filedOne = isLwop ? lwopService.applyLwopLeave : silService.applySilLeave;
    // Recording as absent files the LWOP on the employee's behalf, then marks it approved.
    const withRecording = (fn) => async (args) => {
      const saved = await fn(args);
      if (recording) {
        const groupId = Array.isArray(saved) ? saved[0]?.leave_group_id : saved?.leave_group_id;
        await lwopService.recordLwopLeaveAsApproved({ groupId, hrId: user.id });
      }
      return saved;
    };
    const applyLeaveRange = withRecording(filedRange);
    const applyLeave = withRecording(filedOne);

    if (silApplyMode === 'range') {
      const days = enumerateDateRange(silRangeStart, silRangeEnd);
      if (days.length === 0 || !silReason || !silCategoryId) {
        toast.error('Please fill in all fields.');
        return;
      }

      setSilSubmitting(true);
      try {
        const attachments = await silFiles.upload();
        await applyLeaveRange({
          employeeId,
          days: days.map((date) => ({ date, hours: parseFloat(silDayHours[date] ?? DEFAULT_DAY_HOURS) })),
          reason: silReason,
          categoryId: silCategoryId,
          employeeName,
          attachments,
          headId: recording ? null : silHeadId,
        });
        toast.success(`${leaveLabel} ${recording ? 'recorded as approved' : 'application submitted'} for ${days.length} day${days.length > 1 ? 's' : ''}!`);
        setSilRangeStart('');
        setSilRangeEnd('');
        setSilDayHours({});
        setSilCategoryId('');
        setSilReason('');
        setSilHeadId('');
        silFiles.clear();
        onSuccess?.();
        onClose();
      } catch (err) {
        toast.error(err.message || `Failed to submit ${leaveLabel}.`);
      } finally {
        setSilSubmitting(false);
      }
      return;
    }

    if (!silDate || !silStartTime || !silEndTime || !silReason || !silCategoryId) {
      toast.error('Please fill in all fields.');
      return;
    }

    setSilSubmitting(true);
    try {
      const attachments = await silFiles.upload();
      await applyLeave({
        employeeId,
        date: silDate,
        startTime: silStartTime,
        endTime: silEndTime,
        reason: silReason,
        categoryId: silCategoryId,
        employeeName,
        attachments,
        headId: recording ? null : silHeadId,
      });
      toast.success(recording ? `${leaveLabel} recorded as approved!` : `${leaveLabel} application submitted!`);
      setSilDate('');
      setSilCategoryId('');
      setSilStartTime('');
      setSilEndTime('');
      setSilReason('');
      setSilHeadId('');
      silFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || `Failed to submit ${leaveLabel}.`);
    } finally {
      setSilSubmitting(false);
    }
  };

  const handleApplyUndertime = async (e) => {
    e.preventDefault();
    if (!employeeId || !utHeadId) {
      toast.error('Please fill in all fields.');
      return;
    }
    if (!utDate || !utOriginalStart || !utOriginalEnd || !utActualStart || !utActualEnd || !utReason) {
      toast.error('Please fill in all fields.');
      return;
    }

    try {
      assertNotWeekend(utDate);
    } catch (err) {
      toast.error(err.message);
      return;
    }

    setUtSubmitting(true);
    try {
      const attachments = await utFiles.upload();
      await offsetService.applyUndertime({
        employeeId,
        date: utDate,
        originalStartTime: utOriginalStart,
        originalEndTime: utOriginalEnd,
        actualStartTime: utActualStart,
        actualEndTime: utActualEnd,
        reason: utReason,
        employeeName,
        attachments,
        headId: utHeadId,
      });
      toast.success('Undertime application submitted!');
      setUtDate('');
      setUtOriginalStart('');
      setUtOriginalEnd('');
      setUtActualStart('');
      setUtActualEnd('');
      setUtReason('');
      setUtHeadId('');
      utFiles.clear();
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to submit undertime application.');
    } finally {
      setUtSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-md sm:max-w-md flex flex-col overflow-hidden p-0 gap-0">

        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            Time Off & Overtime
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="h-auto w-auto text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} strokeWidth={2.5} />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <TabGroup
            variant="pill"
            tabs={[
              { value: 'overtime', label: 'Overtime' },
              { value: 'offset', label: 'Offset' },
              { value: 'sil', label: 'Leave' },
              { value: 'undertime', label: 'Undertime' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="sm"
          />

          {showEmployeeSelector && (
            <div>
              <FieldBox label="Employee" className="block mb-1.5" />
              <SelectField
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                options={employees.map((x) => ({ value: x.id, label: x.name }))}
                placeholder="Select employee..."
                className="w-full"
              />
            </div>
          )}

          {activeTab === 'overtime' && (
            <form onSubmit={handleApplyOvertime} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <PlusCircle size={16} className="text-primary" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  Request Overtime
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <FieldBox label="Date Worked" />
                  <Input
                    type="date"
                    value={otDate}
                    onChange={(e) => setOtDate(e.target.value)}
                    containerClassName="w-full" className="font-semibold"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldBox label="Start Time" className="block mb-1.5" />
                  <Input
                    type="time"
                    value={otStartTime}
                    onChange={(e) => setOtStartTime(e.target.value)}
                    containerClassName="w-full" className="font-semibold"
                    required
                  />
                </div>
                <div>
                  <FieldBox label="End Time" className="block mb-1.5" />
                  <Input
                    type="time"
                    value={otEndTime}
                    onChange={(e) => setOtEndTime(e.target.value)}
                    containerClassName="w-full" className="font-semibold"
                    required
                  />
                </div>
              </div>
              {currentOtHours > 0 && (
                <div className="text-xs font-semibold text-primary/80 px-1">
                  Derived: {currentOtHours} hrs
                </div>
              )}
              <HeadSelectField employee={selectedEmployee} value={otHeadId} onChange={setOtHeadId} />
              <div>
                <FieldBox label="Reason" className="block mb-1.5" />
                <Textarea
                  value={otReason}
                  onChange={(e) => setOtReason(e.target.value)}
                  placeholder="Reason for the overtime request"
                  rows={3}
                  className="min-h-0 resize-none px-3.5 py-2.5 text-sm md:text-sm font-semibold"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={otFiles}
                disabled={otSubmitting}
                hint={`Optional — approval email, logbook photo, or similar. Up to ${otFiles.max} files, 10.0 MB each.`}
              />
              <Button
                type="submit"
                disabled={otSubmitting}
                className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer mt-4"
              >
                {otSubmitting
                  ? otFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Submit Request'}
              </Button>
            </form>
          )}

          {activeTab === 'offset' && (
            <form onSubmit={handleApplyOffsetLeave} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <Calendar size={16} className="text-blue-11" />
                  <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                    Request Offset
                  </h3>
                </div>
                <TabGroup
                  variant="pill"
                  tabs={[
                    { value: 'single', label: 'Single day' },
                    { value: 'range', label: 'Date range' },
                  ]}
                  activeTab={offsetApplyMode}
                  onChange={setOffsetApplyMode}
                  size="sm"
                />
              </div>
              {employeeId && (
                <div className="text-xs font-semibold text-muted-foreground px-1">
                  Available: <span className="text-blue-11 font-black">{availableOffsetHours} hrs</span>
                  {pendingOffsetHours > 0 && ` (${pendingOffsetHours} hrs already committed to pending applications)`}
                </div>
              )}
              {offsetApplyMode === 'range' ? (
                <RangeDayEditor
                  startDate={offsetRangeStart}
                  endDate={offsetRangeEnd}
                  onStartDateChange={setOffsetRangeStart}
                  onEndDateChange={setOffsetRangeEnd}
                  dayHours={offsetDayHours}
                  onDayHoursChange={(date, hours) => setOffsetDayHours((prev) => ({ ...prev, [date]: hours }))}
                />
              ) : (
                <>
                  <div>
                    <FieldBox label="Offset Date" className="block mb-1.5" />
                    <Input
                      type="date"
                      value={offsetDate}
                      onChange={(e) => setOffsetDate(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <FieldBox label="Start Time" className="block mb-1.5" />
                      <Input
                        type="time"
                        value={offsetStartTime}
                        onChange={(e) => setOffsetStartTime(e.target.value)}
                        containerClassName="w-full" className="font-semibold"
                        required
                      />
                    </div>
                    <div>
                      <FieldBox label="End Time" className="block mb-1.5" />
                      <Input
                        type="time"
                        value={offsetEndTime}
                        onChange={(e) => setOffsetEndTime(e.target.value)}
                        containerClassName="w-full" className="font-semibold"
                        required
                      />
                    </div>
                  </div>
                  {currentOffsetHours > 0 && (
                    <div className="text-xs font-semibold text-blue-11 px-1">
                      Derived: {currentOffsetHours} hrs
                      {currentOffsetHours !== currentOffsetHoursRaw && ' (meal break deducted)'}
                    </div>
                  )}
                </>
              )}
              <HeadSelectField employee={selectedEmployee} value={offsetHeadId} onChange={setOffsetHeadId} />
              <div>
                <FieldBox label="Reason" className="block mb-1.5" />
                <Textarea
                  value={offsetReason}
                  onChange={(e) => setOffsetReason(e.target.value)}
                  placeholder="Reason for the Offset"
                  rows={3}
                  className="min-h-0 resize-none px-3.5 py-2.5 text-sm md:text-sm font-semibold"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={offsetFiles}
                disabled={offsetSubmitting}
                hint={`Optional — up to ${offsetFiles.max} files, 10.0 MB each. Images, PDFs and documents.`}
              />
              <Button
                type="submit"
                disabled={offsetSubmitting}
                className="w-full h-11 rounded-xl font-bold bg-blue-9 hover:bg-blue-10 text-white shadow-md cursor-pointer mt-4"
              >
                {offsetSubmitting
                  ? offsetFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Apply for Leave'}
              </Button>
            </form>
          )}

          {activeTab === 'sil' && (
            <form onSubmit={handleApplySilLeave} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <Calendar size={16} className="text-green-11" />
                  <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                    {leavePay === 'lwop' ? 'Request Leave Without Pay' : 'Request Service Incentive Leave'}
                  </h3>
                </div>
                <TabGroup
                  variant="pill"
                  tabs={[
                    { value: 'single', label: 'Single day' },
                    { value: 'range', label: 'Date range' },
                  ]}
                  activeTab={silApplyMode}
                  onChange={setSilApplyMode}
                  size="sm"
                />
              </div>
              <div>
                <FieldBox label="Pay" className="block mb-1.5" />
                <TabGroup
                  variant="pill"
                  tabs={[
                    { value: 'sil', label: 'With pay (SIL)' },
                    { value: 'lwop', label: 'Without pay (LWOP)' },
                  ]}
                  activeTab={leavePay}
                  onChange={setLeavePay}
                  size="sm"
                />
              </div>
              {employeeId && leavePay === 'sil' && (
                <div className="text-xs font-semibold text-muted-foreground px-1">
                  Available: <span className="text-green-11 font-black">{availableSilHours} hrs</span>
                  {pendingSilHours > 0 && ` (${pendingSilHours} hrs already committed to pending applications)`}
                </div>
              )}
              <div>
                <FieldBox label="Category" className="block mb-1.5" />
                <SelectField
                value={silCategoryId}
                onChange={setSilCategoryId}
                options={categories.map((x) => ({ value: x.id, label: x.label }))}
                placeholder="Select category..."
                className="w-full"
              />
              </div>
              {silApplyMode === 'range' ? (
                <RangeDayEditor
                  startDate={silRangeStart}
                  endDate={silRangeEnd}
                  onStartDateChange={setSilRangeStart}
                  onEndDateChange={setSilRangeEnd}
                  dayHours={silDayHours}
                  onDayHoursChange={(date, hours) => setSilDayHours((prev) => ({ ...prev, [date]: hours }))}
                />
              ) : (
                <>
                  <div>
                    <FieldBox label="Leave Date" className="block mb-1.5" />
                    <Input
                      type="date"
                      value={silDate}
                      onChange={(e) => setSilDate(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <FieldBox label="Start Time" className="block mb-1.5" />
                      <Input
                        type="time"
                        value={silStartTime}
                        onChange={(e) => setSilStartTime(e.target.value)}
                        containerClassName="w-full" className="font-semibold"
                        required
                      />
                    </div>
                    <div>
                      <FieldBox label="End Time" className="block mb-1.5" />
                      <Input
                        type="time"
                        value={silEndTime}
                        onChange={(e) => setSilEndTime(e.target.value)}
                        containerClassName="w-full" className="font-semibold"
                        required
                      />
                    </div>
                  </div>
                  {currentSilHours > 0 && (
                    <div className="text-xs font-semibold text-green-11 px-1">
                      Derived: {currentSilHours} hrs
                      {currentSilHours !== currentSilHoursRaw && ' (meal break deducted)'}
                    </div>
                  )}
                </>
              )}
              {canRecordAbsent && (
                <div
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3.5 py-3 text-sm font-semibold text-foreground"
                  onClick={(e) => e.target === e.currentTarget && setRecordAbsent(!recordAbsent)}
                >
                  <Checkbox checked={recordAbsent} onCheckedChange={setRecordAbsent} aria-label="Record as absent (already approved)" />
                  <span onClick={() => setRecordAbsent(!recordAbsent)}>Record as absent (already approved)</span>
                </div>
              )}
              {!(canRecordAbsent && recordAbsent) && (
                <HeadSelectField employee={selectedEmployee} value={silHeadId} onChange={setSilHeadId} />
              )}
              <div>
                <FieldBox label="Reason" className="block mb-1.5" />
                <Textarea
                  value={silReason}
                  onChange={(e) => setSilReason(e.target.value)}
                  placeholder="Reason for taking leave"
                  rows={3}
                  className="min-h-0 resize-none px-3.5 py-2.5 text-sm md:text-sm font-semibold"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={silFiles}
                disabled={silSubmitting}
                hint={`Optional — medical certificate or similar. Up to ${silFiles.max} files, 10.0 MB each.`}
              />
              <Button
                type="submit"
                disabled={silSubmitting}
                className="w-full h-11 rounded-xl font-bold bg-green-9 hover:bg-green-10 text-white shadow-md cursor-pointer mt-4"
              >
                {silSubmitting
                  ? silFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Apply for Leave'}
              </Button>
            </form>
          )}

          {activeTab === 'undertime' && (
            <form onSubmit={handleApplyUndertime} className="space-y-4 animate-in fade-in duration-300">
              <div className="flex items-center space-x-2 pb-2 mb-2 border-b border-border">
                <Clock size={16} className="text-amber-11" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  File Undertime
                </h3>
              </div>
              <div>
                <FieldBox label="Date" className="block mb-1.5" />
                <Input
                  type="date"
                  value={utDate}
                  onChange={(e) => setUtDate(e.target.value)}
                  containerClassName="w-full" className="font-semibold"
                  required
                />
              </div>
              <div>
                <p className="text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Original Work Schedule
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldBox label="Start" className="block mb-1" />
                    <Input
                      type="time"
                      value={utOriginalStart}
                      onChange={(e) => setUtOriginalStart(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <FieldBox label="End" className="block mb-1" />
                    <Input
                      type="time"
                      value={utOriginalEnd}
                      onChange={(e) => setUtOriginalEnd(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
                  Actual Work Schedule
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FieldBox label="Start" className="block mb-1" />
                    <Input
                      type="time"
                      value={utActualStart}
                      onChange={(e) => setUtActualStart(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <FieldBox label="End" className="block mb-1" />
                    <Input
                      type="time"
                      value={utActualEnd}
                      onChange={(e) => setUtActualEnd(e.target.value)}
                      containerClassName="w-full" className="font-semibold"
                      required
                    />
                  </div>
                </div>
              </div>
              {currentUtHours > 0 && (
                <div className="text-xs font-semibold text-amber-11 px-1">
                  Derived shortfall: {currentUtHours} hrs
                </div>
              )}
              <HeadSelectField employee={selectedEmployee} value={utHeadId} onChange={setUtHeadId} />
              <div>
                <FieldBox label="Purpose" className="block mb-1.5" />
                <Textarea
                  value={utReason}
                  onChange={(e) => setUtReason(e.target.value)}
                  placeholder="Purpose of the undertime"
                  rows={3}
                  className="min-h-0 resize-none px-3.5 py-2.5 text-sm md:text-sm font-semibold"
                  required
                />
              </div>
              <AttachmentField
                label="Supporting Files"
                attachments={utFiles}
                disabled={utSubmitting}
                hint={`Optional — supporting documentation. Up to ${utFiles.max} files, 10.0 MB each.`}
              />
              <Button
                type="submit"
                disabled={utSubmitting}
                className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer mt-4"
              >
                {utSubmitting
                  ? utFiles.isUploading
                    ? 'Uploading files...'
                    : 'Submitting...'
                  : 'Submit Undertime'}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
