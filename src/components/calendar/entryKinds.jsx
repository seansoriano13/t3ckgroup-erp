import { CalendarClock, CalendarDays, CalendarOff, ClipboardList, Hourglass, PartyPopper, Timer, Users, Wrench } from 'lucide-react';
import MeetingDetail from './MeetingDetail.jsx';

/**
 * The Calendar's entry-kind registry (ADR 0037). One entry per `kind` the
 * server's `calendar_entries()` can return; it holds everything a screen needs
 * to draw that kind. Adding a kind is one branch in the SQL function plus one
 * entry here. No screen, filter or toggle changes.
 *
 *   layer    which toggle owns it (a key of LAYERS)
 *   label    the name people read
 *   icon     lucide icon
 *   chip     colour tokens for a month-cell chip / list row
 *   dot      colour token for a small marker (also the solid fill)
 *   bar      colour token for a soft bar (Gantt-style spans)
 *   Detail   optional component that replaces the default detail body; it
 *            receives `{ entry }`. Omit it to get the shared who/when/status/hours.
 */
export const LAYERS = [
  { key: 'meetings', label: 'Meetings', icon: Users },
  { key: 'timeOff', label: 'Time Off', icon: CalendarDays },
  { key: 'overtime', label: 'Overtime', icon: Timer },
];

/** The name people read for a layer: the `meetings` layer holds Activities. */
export const layerLabel = (layer) => (layer.key === 'meetings' ? 'Activities' : layer.label);

export const DEFAULT_LAYERS = { meetings: true, timeOff: true, overtime: true };

/** The preset for the filtered views (HR's Time Off & Overtime tab, My Requests): no Meetings. */
export const TIME_OFF_OVERTIME_LAYERS = { meetings: false, timeOff: true, overtime: true };

export const ENTRY_KINDS = {
  MEETING: {
    layer: 'meetings',
    label: 'Meeting',
    icon: Users,
    chip: 'bg-teal-2 text-teal-11 border-teal-6',
    dot: 'bg-teal-9',
    bar: 'bg-teal-5',
    Detail: MeetingDetail,
  },
  SIL: {
    layer: 'timeOff',
    label: 'SIL',
    icon: CalendarDays,
    chip: 'bg-green-2 text-green-11 border-green-6',
    dot: 'bg-green-9',
    bar: 'bg-green-5',
  },
  OFFSET: {
    layer: 'timeOff',
    label: 'Offset',
    icon: CalendarClock,
    chip: 'bg-blue-2 text-blue-11 border-blue-6',
    dot: 'bg-blue-9',
    bar: 'bg-blue-5',
  },
  LWOP: {
    layer: 'timeOff',
    label: 'LWOP',
    icon: CalendarOff,
    chip: 'bg-pink-2 text-pink-11 border-pink-6',
    dot: 'bg-pink-9',
    bar: 'bg-pink-5',
  },
  UNDERTIME: {
    layer: 'timeOff',
    label: 'Undertime',
    icon: Hourglass,
    chip: 'bg-amber-2 text-amber-11 border-amber-6',
    dot: 'bg-amber-9',
    bar: 'bg-amber-5',
  },
  OVERTIME: {
    layer: 'overtime',
    label: 'Overtime',
    icon: Timer,
    chip: 'bg-violet-2 text-violet-11 border-violet-6',
    dot: 'bg-violet-9',
    bar: 'bg-violet-5',
  },
};

/**
 * The four Activity types, each in its own colour. All four ride on kind
 * MEETING; the type is `details.activity_type`. Meeting keeps the original teal.
 *   text     the text colour alone (for buttons that draw their own fill)
 *   soft     the soft fill for a small time button
 *   pending  the dashed-border colour for a pending one
 */
export const ACTIVITY_TYPES = {
  MEETING: { label: 'Meeting', icon: Users, chip: 'bg-teal-2 text-teal-11 border-teal-6', dot: 'bg-teal-9', bar: 'bg-teal-5', text: 'text-teal-11', soft: 'bg-teal-3 hover:bg-teal-4', pending: 'border-teal-7' },
  ADMIN_TASK: { label: 'Admin Task', icon: ClipboardList, chip: 'bg-indigo-2 text-indigo-11 border-indigo-6', dot: 'bg-indigo-9', bar: 'bg-indigo-5', text: 'text-indigo-11', soft: 'bg-indigo-3 hover:bg-indigo-4', pending: 'border-indigo-7' },
  OPERATIONS_TASK: { label: 'Operations Task', icon: Wrench, chip: 'bg-orange-2 text-orange-11 border-orange-6', dot: 'bg-orange-9', bar: 'bg-orange-5', text: 'text-orange-11', soft: 'bg-orange-3 hover:bg-orange-4', pending: 'border-orange-7' },
  EVENT: { label: 'Event', icon: PartyPopper, chip: 'bg-plum-2 text-plum-11 border-plum-6', dot: 'bg-plum-9', bar: 'bg-plum-5', text: 'text-plum-11', soft: 'bg-plum-3 hover:bg-plum-4', pending: 'border-plum-7' },
};

/** The Activity type of an entry; entries without one are Meetings. */
export function activityTypeOf(entry) {
  const t = entry?.details?.activity_type;
  return ACTIVITY_TYPES[t] ? t : 'MEETING';
}

/**
 * What to draw for an entry: its kind's definition, with an Activity's own
 * type colours, label and icon laid over it. Null for an unregistered kind.
 */
export function styleOf(entry) {
  const def = kindOf(entry?.kind);
  if (!def || entry.kind !== 'MEETING') return def;
  return { ...def, ...ACTIVITY_TYPES[activityTypeOf(entry)] };
}

/** The registered definition for a kind, or null for one this build does not know yet. */
export function kindOf(kind) {
  return ENTRY_KINDS[kind] ?? null;
}

/** The layer a kind belongs to, or null when unregistered. */
export function layerOf(kind) {
  return kindOf(kind)?.layer ?? null;
}

/** Entries whose layer is switched on. Kinds the client does not know are skipped. */
export function visibleEntries(entries, layers = DEFAULT_LAYERS, activityTypes = []) {
  return (entries ?? []).filter((entry) => {
    const layer = layerOf(entry.kind);
    if (layer === null || layers[layer] === false) return false;
    // The Activity type filter only touches Activities; none chosen shows them all.
    if (entry.kind === 'MEETING' && activityTypes.length > 0) return activityTypes.includes(activityTypeOf(entry));
    return true;
  });
}
