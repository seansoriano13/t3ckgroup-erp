import { CalendarClock, CalendarDays, CalendarOff, Hourglass, Timer, Users } from 'lucide-react';

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
 *   dot      colour token for a small marker
 *   Detail   optional component that replaces the default detail body; it
 *            receives `{ entry }`. Omit it to get the shared who/when/status/hours.
 */
export const LAYERS = [
  { key: 'meetings', label: 'Meetings', icon: Users },
  { key: 'timeOff', label: 'Time Off', icon: CalendarDays },
  { key: 'overtime', label: 'Overtime', icon: Timer },
];

export const DEFAULT_LAYERS = { meetings: true, timeOff: true, overtime: true };

export const ENTRY_KINDS = {
  SIL: {
    layer: 'timeOff',
    label: 'SIL',
    icon: CalendarDays,
    chip: 'bg-green-2 text-green-11 border-green-6',
    dot: 'bg-green-9',
  },
  OFFSET: {
    layer: 'timeOff',
    label: 'Offset',
    icon: CalendarClock,
    chip: 'bg-blue-2 text-blue-11 border-blue-6',
    dot: 'bg-blue-9',
  },
  LWOP: {
    layer: 'timeOff',
    label: 'LWOP',
    icon: CalendarOff,
    chip: 'bg-pink-2 text-pink-11 border-pink-6',
    dot: 'bg-pink-9',
  },
  UNDERTIME: {
    layer: 'timeOff',
    label: 'Undertime',
    icon: Hourglass,
    chip: 'bg-amber-2 text-amber-11 border-amber-6',
    dot: 'bg-amber-9',
  },
  OVERTIME: {
    layer: 'overtime',
    label: 'Overtime',
    icon: Timer,
    chip: 'bg-violet-2 text-violet-11 border-violet-6',
    dot: 'bg-violet-9',
  },
};

/** The registered definition for a kind, or null for one this build does not know yet. */
export function kindOf(kind) {
  return ENTRY_KINDS[kind] ?? null;
}

/** The layer a kind belongs to, or null when unregistered. */
export function layerOf(kind) {
  return kindOf(kind)?.layer ?? null;
}

/** Entries whose layer is switched on. Kinds the client does not know are skipped. */
export function visibleEntries(entries, layers = DEFAULT_LAYERS) {
  return (entries ?? []).filter((entry) => {
    const layer = layerOf(entry.kind);
    return layer !== null && layers[layer] !== false;
  });
}
