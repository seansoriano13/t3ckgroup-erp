import { useMemo } from 'react';
import { CalendarDays, CalendarRange, History, Inbox, Printer, Scale } from 'lucide-react';
import { formatWindow } from '../../../../utils/time';
import { recordKey } from './useDocumentCenter';

/** Formatting and small derived views shared by the Leaves Manager's views. */

export { recordKey };

/** The Leaves Manager's views, in sidebar order. */
export const LEAVE_VIEWS = [
  { value: 'pending', label: 'Pending', icon: Inbox },
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
  { value: 'timeline', label: 'Timeline', icon: CalendarRange },
  { value: 'history', label: 'Request History', icon: History },
  { value: 'documents', label: 'Document Center', icon: Printer },
  { value: 'balances', label: 'Employee Balances', icon: Scale },
];

export const LEAVE_TYPES = ['OFFSET', 'SIL', 'OVERTIME', 'UNDERTIME'];

export const TYPE_META = {
  OFFSET: { label: 'Offset', chip: 'bg-blue-2 text-blue-11 border-blue-6', dot: 'bg-blue-9', solid: 'bg-blue-9', bar: 'bg-blue-5' },
  SIL: { label: 'SIL', chip: 'bg-green-2 text-green-11 border-green-6', dot: 'bg-green-9', solid: 'bg-green-9', bar: 'bg-green-5' },
  OVERTIME: { label: 'Overtime', chip: 'bg-muted text-foreground border-border', dot: 'bg-mauve-10', solid: 'bg-mauve-10', bar: 'bg-mauve-5' },
  UNDERTIME: { label: 'Undertime', chip: 'bg-amber-2 text-amber-11 border-amber-6', dot: 'bg-amber-9', solid: 'bg-amber-9', bar: 'bg-amber-5' },
};

const STATUS_META = {
  APPROVED: { label: 'Approved', dot: 'bg-green-9' },
  APPROVED_OFFSET: { label: 'Approved · Offset', dot: 'bg-green-9' },
  APPROVED_PAID: { label: 'Approved · Paid OT', dot: 'bg-blue-9' },
  REJECTED: { label: 'Rejected', dot: 'bg-red-9' },
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const isOverdue = (r) => (r.date || '').slice(0, 10) < todayIso();

/** Label + dot color for a record's current state, pending included. */
export function statusOf(r) {
  if (r.status === 'PENDING') return isOverdue(r) ? { label: 'Overdue', dot: 'bg-red-9' } : { label: 'Pending', dot: 'bg-amber-9' };
  return STATUS_META[r.status] || { label: r.status, dot: 'bg-mauve-9' };
}

export const fmtDay = (v, o = { month: 'short', day: 'numeric' }) => new Date(v).toLocaleDateString('en-US', o);

/** "Oct 6" or "Oct 6 – Oct 8"; `long` adds the weekday. */
export function fmtRange(r, long = false) {
  const o = long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' };
  return r.dayCount > 1 ? `${fmtDay(r.startDate, o)} – ${fmtDay(r.endDate, o)}` : fmtDay(r.date, o);
}

export const windowOf = (r) => (r.start_time && r.end_time ? formatWindow(r.start_time, r.end_time) : null);

/** Hours HR granted, and whether that differs from what was asked (#328). */
export function hoursOf(r) {
  const changed = (r.type === 'OVERTIME' || r.type === 'OFFSET') && r.approved_hours != null && r.approved_hours !== r.hours;
  return { requested: r.hours, granted: changed ? r.approved_hours : r.hours, changed };
}

export const balanceFor = (r) =>
  r.type === 'OFFSET' ? r.employee?.offset_hours_balance : r.type === 'SIL' ? r.employee?.sil_hours_balance : null;

/** "3 d", "5 h"; a plain date once older than a month. */
export function relTime(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} m`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d`;
  return fmtDay(iso);
}

export function ago(iso) {
  const t = relTime(iso);
  return /\d [mhd]$/.test(t) ? `${t} ago` : t;
}

/** Pending hours per `${employeeId}_${type}`, from the whole (unfiltered) queue. */
export function usePendingByEmployee(pendingLeaves) {
  return useMemo(() => {
    const m = new Map();
    for (const r of pendingLeaves) {
      const k = `${r.employee_id}_${r.type}`;
      m.set(k, (m.get(k) || 0) + parseFloat(r.hours || 0));
    }
    return m;
  }, [pendingLeaves]);
}

/** Who is out today / tomorrow, from the per-day approved rows. */
export function useWhoIsOut(approvedLeaves) {
  return useMemo(() => {
    const t = todayIso();
    const tm = new Date();
    tm.setDate(tm.getDate() + 1);
    const tmIso = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
    const pick = (day) => {
      const m = new Map();
      approvedLeaves.filter((r) => (r.date || '').slice(0, 10) === day).forEach((r) => m.set(`${r.employee_id}_${r.type}`, r));
      return [...m.values()];
    };
    return { today: pick(t), tomorrow: pick(tmIso) };
  }, [approvedLeaves]);
}

export const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground';
