import React, { useState, useMemo, useEffect } from 'react';
import ModalShell from '@/components/ui/ModalShell';
import { useAuth } from '../../context/AuthContext';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';
import { lwopService } from '../../services/lwopService';
import { hrSettingsService } from '../../services/hrSettingsService';
import { employeeService } from '../../services/employeeService';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import TabGroup from '../ui/TabGroup';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { AttachmentField } from '../ui/Attachments';
import { useFileAttachments } from '../../hooks/useFileAttachments';
import { safeDeriveHours } from '../../utils/time';
import { applyLunchDeduction, previewLeaveHours, computeAvailableHours, deriveUndertimeHours, assertNotWeekend } from '../../services/leaveRules';
import { enumerateDateRange } from '../../utils/dateUtils';
import { dayShiftService } from '../../services/dayShiftService';
import { DEFAULT_DAY_SHIFT_CONFIG, getShiftForDate, isWorkingDay } from '../../services/dayShift';
import HeadSelectField from './HeadSelectField';
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";
const DEFAULT_DAY_HOURS = 8;

/** A red line under a field that failed the submit check. */
function FieldError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="px-1 pt-1 text-xs font-semibold text-destructive">
      {children}
    </p>
  );
}

/**
 * One labelled field: caption (with the red asterisk when required), the
 * control, and its error line. `name` lets the submit check scroll to it.
 */
function Field({ name, label, required, error, className, children }) {
  return (
    <div data-field={name} className={className}>
      <FieldBox label={label} required={required} className="block mb-1.5" />
      {children}
      <FieldError>{error}</FieldError>
    </div>
  );
}

const SUBMIT_LABEL = {
  overtime: 'File overtime',
  offset: 'File Offset',
  sil: 'File leave',
  undertime: 'File undertime',
};

function scrollToField(name) {
  const el = document.querySelector(`[data-field="${name}"]`);
  el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

/**
 * A range day's starting hours: the length of that weekday's shift from the
 * day-shift config (before the lunch deduction, which the editor shows as
 * "net"), falling back to 8 only when the shift has no times set.
 */
function defaultDayHours(date, dayShiftConfig) {
  const shift = getShiftForDate(date, dayShiftConfig);
  const hours = shift.isWorkingDay ? safeDeriveHours(shift.startTime, shift.endTime) : 0;
  return hours > 0 ? hours : DEFAULT_DAY_HOURS;
}

/**
 * The dates a range actually files: working days only (a weekend inside the
 * range used to make the whole submission fail), minus any day the employee
 * removed. A removed day is stored as `null` in `dayHours`.
 */
function rangeFiledDays(startDate, endDate, dayShiftConfig, dayHours) {
  return enumerateDateRange(startDate, endDate)
    .filter((date) => isWorkingDay(date, dayShiftConfig) && dayHours[date] !== null);
}

function rangeDayHours(date, dayShiftConfig, dayHours) {
  return parseFloat(dayHours[date] ?? defaultDayHours(date, dayShiftConfig)) || 0;
}

const formatRangeDay = (date) =>
  new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * Lets an employee cover several consecutive days in one submission (ticket
 * #63) instead of applying day by day. Non-working days are left out, each
 * day starts at its scheduled shift length and is individually editable or
 * removable, so a half-day or a holiday inside the range stays expressible;
 * the actual grouping into one `leave_group_id` happens server-side.
 */
function RangeDayEditor({ startDate, endDate, onStartDateChange, onEndDateChange, dayHours, onDayHoursChange, dayShiftConfig, errors = {} }) {
  const allDays = enumerateDateRange(startDate, endDate);
  const days = rangeFiledDays(startDate, endDate, dayShiftConfig, dayHours);
  const nonWorkingDays = allDays.filter((date) => !isWorkingDay(date, dayShiftConfig));
  const removedDays = allDays.filter((date) => isWorkingDay(date, dayShiftConfig) && dayHours[date] === null);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <Field name="rangeStart" label="From" required error={errors.rangeStart}>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            containerClassName="w-full" className="font-semibold"
            error={!!errors.rangeStart}
          />
        </Field>
        <Field name="rangeEnd" label="To" required error={errors.rangeEnd}>
          <Input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => onEndDateChange(e.target.value)}
            containerClassName="w-full" className="font-semibold"
            error={!!errors.rangeEnd}
          />
        </Field>
      </div>

      {allDays.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {days.map((date) => {
            const rawHours = rangeDayHours(date, dayShiftConfig, dayHours);
            const netHours = applyLunchDeduction(rawHours);
            return (
              <div key={date} className="flex items-center justify-between gap-3 bg-muted/60 border border-border rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-foreground">
                  {formatRangeDay(date)}
                </span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={dayHours[date] ?? defaultDayHours(date, dayShiftConfig)}
                    onChange={(e) => onDayHoursChange(date, e.target.value)}
                    containerClassName="w-16 shrink-0"
                    className="h-auto px-2 py-1 rounded-md text-xs font-bold text-right"
                    aria-label={`Hours for ${formatRangeDay(date)}`}
                  />
                  <span className="text-label font-semibold text-muted-foreground uppercase">hrs</span>
                  {netHours !== rawHours && (
                    <span className="text-[10px] font-semibold text-muted-foreground">→ {netHours} net</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onDayHoursChange(date, null)}
                    className="text-muted-foreground"
                    aria-label={`Remove ${formatRangeDay(date)}`}
                    title="Remove this day"
                  >
                    <X />
                  </Button>
                </div>
              </div>
            );
          })}
          {removedDays.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5">
              <span className="text-[10px] font-semibold text-muted-foreground">Removed:</span>
              {removedDays.map((date) => (
                <Button
                  key={date}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onDayHoursChange(date, undefined)}
                  className="text-[10px] font-semibold text-muted-foreground"
                  title="Add this day back"
                >
                  + {formatRangeDay(date)}
                </Button>
              ))}
            </div>
          )}
          {nonWorkingDays.length > 0 && (
            <p className="text-[10px] font-semibold text-muted-foreground px-1">
              Skipped (not a working day): {nonWorkingDays.map(formatRangeDay).join(', ')}
            </p>
          )}
          <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-0.5">
            {days.length} day{days.length !== 1 ? 's' : ''} · {days.reduce((sum, d) => sum + applyLunchDeduction(rangeDayHours(d, dayShiftConfig, dayHours)), 0)} hrs total (1 hr lunch deducted per day of 5+ hrs)
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
  // Set by the first filing attempt on a tab: from then on its missing fields show a red line.
  const [attempted, setAttempted] = useState(false);

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

  // The hours the open Offset / Leave form would spend, as soon as they are
  // known (the same net-of-lunch figure the server checks).
  const rangeNetHours = (start, end, dayHours) =>
    rangeFiledDays(start, end, dayShiftConfig, dayHours).reduce(
      (sum, d) => sum + applyLunchDeduction(rangeDayHours(d, dayShiftConfig, dayHours)),
      0,
    );
  const balanceCheck = (() => {
    if (!employeeId) return null;
    if (activeTab === 'offset') {
      const needed = offsetApplyMode === 'range'
        ? rangeNetHours(offsetRangeStart, offsetRangeEnd, offsetDayHours)
        : currentOffsetHours;
      return { needed, available: availableOffsetHours, noun: 'Offset' };
    }
    if (activeTab === 'sil' && leavePay === 'sil') {
      const needed = silApplyMode === 'range'
        ? rangeNetHours(silRangeStart, silRangeEnd, silDayHours)
        : currentSilHours;
      return { needed, available: availableSilHours, noun: 'SIL' };
    }
    return null;
  })();
  const shortfall = balanceCheck && balanceCheck.needed > balanceCheck.available
    ? `You have ${balanceCheck.available} ${balanceCheck.noun} hours. This needs ${balanceCheck.needed}.`
    : null;

  // Every missing field of the open tab, in the order they appear. Empty
  // object means the form can be filed.
  const validate = () => {
    const found = {};
    const need = (key, ok, message) => {
      if (!ok) found[key] = message;
    };
    if (showEmployeeSelector) need('employee', selectedEmployeeId, 'Choose an employee.');
    const rangeNeeds = (start, end, dayHours) => {
      need('rangeStart', start, 'Enter the first day.');
      need('rangeEnd', end, 'Enter the last day.');
      if (start && end && rangeFiledDays(start, end, dayShiftConfig, dayHours).length === 0) {
        found.rangeEnd = 'No working days in this range.';
      }
    };
    if (activeTab === 'overtime') {
      need('otDate', otDate, 'Enter the date worked.');
      need('otStart', otStartTime, 'Enter the start time.');
      need('otEnd', otEndTime, 'Enter the end time.');
      need('head', otHeadId, 'Choose a department head.');
      need('reason', otReason.trim(), 'Enter the reason.');
    } else if (activeTab === 'offset') {
      if (offsetApplyMode === 'range') {
        rangeNeeds(offsetRangeStart, offsetRangeEnd, offsetDayHours);
      } else {
        need('date', offsetDate, 'Enter the Offset date.');
        need('start', offsetStartTime, 'Enter the start time.');
        need('end', offsetEndTime, 'Enter the end time.');
      }
      need('head', offsetHeadId, 'Choose a department head.');
      need('reason', offsetReason.trim(), 'Enter the reason.');
    } else if (activeTab === 'sil') {
      need('category', silCategoryId, 'Choose a category.');
      if (silApplyMode === 'range') {
        rangeNeeds(silRangeStart, silRangeEnd, silDayHours);
      } else {
        need('date', silDate, 'Enter the leave date.');
        need('start', silStartTime, 'Enter the start time.');
        need('end', silEndTime, 'Enter the end time.');
      }
      need('head', silHeadId || (canRecordAbsent && recordAbsent), 'Choose a department head.');
      need('reason', silReason.trim(), 'Enter the reason.');
    } else {
      need('date', utDate, 'Enter the date.');
      if (utDate) {
        try {
          assertNotWeekend(utDate);
        } catch (err) {
          found.date = err.message;
        }
      }
      need('origStart', utOriginalStart, 'Enter the original start time.');
      need('origEnd', utOriginalEnd, 'Enter the original end time.');
      need('actStart', utActualStart, 'Enter the actual start time.');
      need('actEnd', utActualEnd, 'Enter the actual end time.');
      need('head', utHeadId, 'Choose a department head.');
      need('reason', utReason.trim(), 'Enter the purpose.');
    }
    return found;
  };

  // After the first filing attempt the errors follow the form live, so a
  // line clears as soon as its field is filled.
  const errors = attempted ? validate() : {};

  // True (and the first missing field in view) when the form is not ready.
  const blocked = () => {
    const found = validate();
    setAttempted(true);
    const first = Object.keys(found)[0];
    if (first) scrollToField(first);
    return Boolean(first);
  };

  const submitting = { overtime: otSubmitting, offset: offsetSubmitting, sil: silSubmitting, undertime: utSubmitting }[activeTab];
  const uploading = { overtime: otFiles, offset: offsetFiles, sil: silFiles, undertime: utFiles }[activeTab].isUploading;
  const handleSubmit = (e) => {
    e.preventDefault();
    const handler = {
      overtime: handleApplyOvertime,
      offset: handleApplyOffsetLeave,
      sil: handleApplySilLeave,
      undertime: handleApplyUndertime,
    }[activeTab];
    return handler(e);
  };

  if (!isOpen) return null;

  const handleApplyOvertime = async (e) => {
    e.preventDefault();
    if (blocked()) return;

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
    if (blocked()) return;

    if (offsetApplyMode === 'range') {
      const days = rangeFiledDays(offsetRangeStart, offsetRangeEnd, dayShiftConfig, offsetDayHours);

      setOffsetSubmitting(true);
      try {
        const attachments = await offsetFiles.upload();
        await offsetService.applyOffsetLeaveRange({
          employeeId,
          days: days.map((date) => ({ date, hours: rangeDayHours(date, dayShiftConfig, offsetDayHours) })),
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
    if (blocked()) return;

    const leaveLabel = isLwop ? 'LWOP' : 'SIL';
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
      const days = rangeFiledDays(silRangeStart, silRangeEnd, dayShiftConfig, silDayHours);

      setSilSubmitting(true);
      try {
        const attachments = await silFiles.upload();
        await applyLeaveRange({
          employeeId,
          days: days.map((date) => ({ date, hours: rangeDayHours(date, dayShiftConfig, silDayHours) })),
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
    if (blocked()) return;

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

  const switchTab = (tab) => {
    setActiveTab(tab);
    setAttempted(false);
  };

  const headField = (value, onChange) => (
    <div data-field="head">
      <HeadSelectField employee={selectedEmployee} value={value} onChange={onChange} required error={errors.head} />
    </div>
  );

  const reasonField = (label, value, onChange, placeholder) => (
    <Field name="reason" label={label} required error={errors.reason}>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        aria-invalid={errors.reason ? true : undefined}
        className="min-h-0 resize-none px-3.5 py-2.5 text-sm md:text-sm font-semibold"
      />
    </Field>
  );

  const timeField = (name, label, value, onChange) => (
    <Field name={name} label={label} required error={errors[name]}>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        containerClassName="w-full" className="font-semibold"
        error={!!errors[name]}
      />
    </Field>
  );

  const dateField = (name, label, value, onChange) => (
    <Field name={name} label={label} required error={errors[name]}>
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        containerClassName="w-full" className="font-semibold"
        error={!!errors[name]}
      />
    </Field>
  );

  // Plain ink on purpose: a coloured balance reads as "fine" even at 0 hrs.
  const balanceLine = (hours, pending) => (
    <div className="text-xs font-semibold text-muted-foreground px-1">
      Available: <span className="text-foreground font-black">{hours} hrs</span>
      {pending > 0 && ` (${pending} hrs already committed to pending applications)`}
    </div>
  );

  const modeSwitch = (mode, setMode) => (
    <TabGroup
      variant="pill"
      tabs={[
        { value: 'single', label: 'Single day' },
        { value: 'range', label: 'Date range' },
      ]}
      activeTab={mode}
      onChange={setMode}
      size="sm"
    />
  );

  return (
    <ModalShell
      open
      onOpenChange={(open) => !open && onClose()}
      crumbs={showEmployeeSelector ? ['Time Off & Overtime', 'File for Employee'] : ['My Requests', 'File Time Off']}
      title={showEmployeeSelector ? 'File Time Off or Overtime for an Employee' : 'File Time Off or Overtime'}
      onSubmit={handleSubmit}
      actions={
        <Button type="submit" disabled={submitting || Boolean(shortfall)}>
          {submitting ? (uploading ? 'Uploading files...' : 'Submitting...') : SUBMIT_LABEL[activeTab]}
        </Button>
      }
    >
      {/* Type tabs stay pinned under the header while the form scrolls */}
      <div className="sticky -top-3 z-10 -mx-5 -mt-3 shrink-0 border-b border-border bg-popover px-5 py-2">
        <TabGroup
          variant="pill"
          tabs={[
            { value: 'overtime', label: 'Overtime' },
            { value: 'offset', label: 'Offset' },
            { value: 'sil', label: 'Leave' },
            { value: 'undertime', label: 'Undertime' },
          ]}
          activeTab={activeTab}
          onChange={switchTab}
          size="sm"
        />
      </div>

      {showEmployeeSelector && (
        <Field name="employee" label="Employee" required error={errors.employee}>
          <SelectField
            value={selectedEmployeeId}
            onChange={setSelectedEmployeeId}
            options={employees.map((x) => ({ value: x.id, label: x.name }))}
            placeholder="Select employee..."
            className="w-full"
          />
        </Field>
      )}

      {activeTab === 'overtime' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="grid grid-cols-2 gap-4">
            {dateField('otDate', 'Date Worked', otDate, setOtDate)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {timeField('otStart', 'Start Time', otStartTime, setOtStartTime)}
            {timeField('otEnd', 'End Time', otEndTime, setOtEndTime)}
          </div>
          {currentOtHours > 0 && (
            <div className="text-xs font-semibold text-muted-foreground px-1">
              Derived: {currentOtHours} hrs
            </div>
          )}
          {headField(otHeadId, setOtHeadId)}
          {reasonField('Reason', otReason, setOtReason, 'Reason for the overtime request')}
          <AttachmentField
            label="Supporting Files"
            attachments={otFiles}
            disabled={otSubmitting}
            hint={`Optional — approval email, logbook photo, or similar. Up to ${otFiles.max} files, 10.0 MB each.`}
          />
        </div>
      )}

      {activeTab === 'offset' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex justify-end">{modeSwitch(offsetApplyMode, setOffsetApplyMode)}</div>
          {employeeId && balanceLine(availableOffsetHours, pendingOffsetHours)}
          {offsetApplyMode === 'range' ? (
            <RangeDayEditor
              startDate={offsetRangeStart}
              endDate={offsetRangeEnd}
              onStartDateChange={setOffsetRangeStart}
              onEndDateChange={setOffsetRangeEnd}
              dayHours={offsetDayHours}
              onDayHoursChange={(date, hours) => setOffsetDayHours((prev) => ({ ...prev, [date]: hours }))}
              dayShiftConfig={dayShiftConfig}
              errors={errors}
            />
          ) : (
            <>
              {dateField('date', 'Offset Date', offsetDate, setOffsetDate)}
              <div className="grid grid-cols-2 gap-4">
                {timeField('start', 'Start Time', offsetStartTime, setOffsetStartTime)}
                {timeField('end', 'End Time', offsetEndTime, setOffsetEndTime)}
              </div>
              {currentOffsetHours > 0 && (
                <div className="text-xs font-semibold text-muted-foreground px-1">
                  Derived: {currentOffsetHours} hrs
                  {currentOffsetHours !== currentOffsetHoursRaw && ' (meal break deducted)'}
                </div>
              )}
            </>
          )}
          {shortfall && <p role="alert" className="px-1 text-xs font-semibold text-destructive">{shortfall}</p>}
          {headField(offsetHeadId, setOffsetHeadId)}
          {reasonField('Reason', offsetReason, setOffsetReason, 'Reason for the Offset')}
          <AttachmentField
            label="Supporting Files"
            attachments={offsetFiles}
            disabled={offsetSubmitting}
            hint={`Optional — up to ${offsetFiles.max} files, 10.0 MB each. Images, PDFs and documents.`}
          />
        </div>
      )}

      {activeTab === 'sil' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex justify-end">{modeSwitch(silApplyMode, setSilApplyMode)}</div>
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
            <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
              Service Incentive Leave (SIL)
            </p>
          </div>
          {employeeId && leavePay === 'sil' && balanceLine(availableSilHours, pendingSilHours)}
          <Field name="category" label="Category" required error={errors.category}>
            <SelectField
              value={silCategoryId}
              onChange={setSilCategoryId}
              options={categories.map((x) => ({ value: x.id, label: x.label }))}
              placeholder="Select category..."
              className="w-full"
            />
          </Field>
          {silApplyMode === 'range' ? (
            <RangeDayEditor
              startDate={silRangeStart}
              endDate={silRangeEnd}
              onStartDateChange={setSilRangeStart}
              onEndDateChange={setSilRangeEnd}
              dayHours={silDayHours}
              onDayHoursChange={(date, hours) => setSilDayHours((prev) => ({ ...prev, [date]: hours }))}
              dayShiftConfig={dayShiftConfig}
              errors={errors}
            />
          ) : (
            <>
              {dateField('date', 'Leave Date', silDate, setSilDate)}
              <div className="grid grid-cols-2 gap-4">
                {timeField('start', 'Start Time', silStartTime, setSilStartTime)}
                {timeField('end', 'End Time', silEndTime, setSilEndTime)}
              </div>
              {currentSilHours > 0 && (
                <div className="text-xs font-semibold text-muted-foreground px-1">
                  Derived: {currentSilHours} hrs
                  {currentSilHours !== currentSilHoursRaw && ' (meal break deducted)'}
                </div>
              )}
            </>
          )}
          {shortfall && <p role="alert" className="px-1 text-xs font-semibold text-destructive">{shortfall}</p>}
          {canRecordAbsent && (
            <div
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3.5 py-3 text-sm font-semibold text-foreground"
              onClick={(e) => e.target === e.currentTarget && setRecordAbsent(!recordAbsent)}
            >
              <Checkbox checked={recordAbsent} onCheckedChange={setRecordAbsent} aria-label="Record as absent (already approved)" />
              <span onClick={() => setRecordAbsent(!recordAbsent)}>Record as absent (already approved)</span>
            </div>
          )}
          {!(canRecordAbsent && recordAbsent) && headField(silHeadId, setSilHeadId)}
          {reasonField('Reason', silReason, setSilReason, 'Reason for taking leave')}
          <AttachmentField
            label="Supporting Files"
            attachments={silFiles}
            disabled={silSubmitting}
            hint={`Optional — medical certificate or similar. Up to ${silFiles.max} files, 10.0 MB each.`}
          />
        </div>
      )}

      {activeTab === 'undertime' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {dateField('date', 'Date', utDate, setUtDate)}
          <div>
            <p className="text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
              Original Work Schedule
            </p>
            <div className="grid grid-cols-2 gap-4">
              {timeField('origStart', 'Start', utOriginalStart, setUtOriginalStart)}
              {timeField('origEnd', 'End', utOriginalEnd, setUtOriginalEnd)}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider">
              Actual Work Schedule
            </p>
            <div className="grid grid-cols-2 gap-4">
              {timeField('actStart', 'Start', utActualStart, setUtActualStart)}
              {timeField('actEnd', 'End', utActualEnd, setUtActualEnd)}
            </div>
          </div>
          {currentUtHours > 0 && (
            <div className="text-xs font-semibold text-muted-foreground px-1">
              Derived shortfall: {currentUtHours} hrs
            </div>
          )}
          {headField(utHeadId, setUtHeadId)}
          {reasonField('Purpose', utReason, setUtReason, 'Purpose of the undertime')}
          <AttachmentField
            label="Supporting Files"
            attachments={utFiles}
            disabled={utSubmitting}
            hint={`Optional — supporting documentation. Up to ${utFiles.max} files, 10.0 MB each.`}
          />
        </div>
      )}
    </ModalShell>
  );
}
