/**
 * Activity settings (#1064): the rules HR and Super Admins set in Settings > Activities. The database reads the
 * same rows live (activity_type_settings, activity_general_settings); this is the app's copy for the form, the
 * New button and the Calendar. The defaults are the rules #1063 and #1056 had in code, so the app is right
 * before the first read and when a read fails.
 */
export const ACTIVITY_TYPE_KEYS = ['MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT'];
export const MEETING_TYPE_KEYS = ['ONSITE', 'ONLINE', 'HYBRID'];

export const DEFAULT_ACTIVITY_SETTINGS = {
  types: {
    MEETING: { name: 'Meeting', color: 'teal', active: true, whoFiles: 'EVERYONE', needsHr: true, multiDay: false },
    ADMIN_TASK: { name: 'Admin Task', color: 'indigo', active: true, whoFiles: 'HEADS', needsHr: false, multiDay: true },
    OPERATIONS_TASK: { name: 'Operations Task', color: 'orange', active: true, whoFiles: 'HEADS', needsHr: false, multiDay: true },
    EVENT: { name: 'Event', color: 'plum', active: true, whoFiles: 'HEADS', needsHr: false, multiDay: true },
  },
  general: {
    meetingTypes: { ONSITE: true, ONLINE: true, HYBRID: true },
    earliestStart: '06:00',
    latestEnd: '21:45',
    timeStep: 15,
    defaultStart: '09:00',
    defaultEnd: '10:00',
    reminderMinutes: 15,
    maxDays: 31,
    guestsAllowed: true,
  },
};

const hhmm = (t, fallback) => (typeof t === 'string' && t.length >= 5 ? t.slice(0, 5) : fallback);

/** The app's shape from the two tables' rows. A missing row or field keeps its default. */
export function settingsFromRows(typeRows = [], generalRow = null) {
  const d = DEFAULT_ACTIVITY_SETTINGS;
  const types = {};
  for (const key of ACTIVITY_TYPE_KEYS) {
    const row = (typeRows ?? []).find((r) => r.activity_type === key);
    types[key] = row
      ? { name: row.name, color: row.color, active: row.active, whoFiles: row.who_files, needsHr: row.needs_hr, multiDay: row.multi_day }
      : d.types[key];
  }
  const g = generalRow;
  const general = g
    ? {
        meetingTypes: { ONSITE: g.meeting_onsite, ONLINE: g.meeting_online, HYBRID: g.meeting_hybrid },
        earliestStart: hhmm(g.earliest_start, d.general.earliestStart),
        latestEnd: hhmm(g.latest_end, d.general.latestEnd),
        timeStep: g.time_step_minutes,
        defaultStart: hhmm(g.default_start, d.general.defaultStart),
        defaultEnd: hhmm(g.default_end, d.general.defaultEnd),
        reminderMinutes: g.reminder_minutes,
        maxDays: g.max_days,
        guestsAllowed: g.guests_allowed,
      }
    : d.general;
  return { types, general };
}

// The settings the app is using right now. The hook that reads them replaces this; plain functions
// (the New button label, the type names) read it without a hook.
let current = DEFAULT_ACTIVITY_SETTINGS;
export const getActivitySettings = () => current;
export const setActivitySettings = (settings) => {
  current = settings ?? DEFAULT_ACTIVITY_SETTINGS;
};

const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};
const toText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The times the form lists: earliest start to latest end, one per step. */
export function timeOptions(general = getActivitySettings().general) {
  const out = [];
  const step = general.timeStep > 0 ? general.timeStep : 15;
  for (let m = toMinutes(general.earliestStart); m <= toMinutes(general.latestEnd); m += step) {
    out.push({ value: toText(m), label: toText(m) });
  }
  return out;
}

/** Every time of day on a step, for the settings pickers. */
export function timesOfDay(step = 15) {
  const out = [];
  if (!(step > 0)) step = 15;
  for (let m = 0; m < 24 * 60; m += step) out.push({ value: toText(m), label: toText(m) });
  return out;
}

/**
 * Keeps the default start and end inside the hours and on the time step after a change to either.
 * Defaults snap down to the step, move inside the window, and keep the end after the start.
 */
export function fitDefaults(general) {
  const lo = toMinutes(general.earliestStart);
  const hi = toMinutes(general.latestEnd);
  const step = general.timeStep;
  const snap = (t) => Math.min(hi, Math.max(lo, Math.floor(toMinutes(t) / step) * step));
  let start = snap(general.defaultStart);
  let end = snap(general.defaultEnd);
  if (end <= start) {
    end = Math.min(hi, start + step);
    if (end <= start) start = Math.max(lo, end - step);
  }
  return { ...general, defaultStart: toText(start), defaultEnd: toText(end) };
}

/** The Meeting types that are switched on, in the usual order. */
export const enabledMeetingTypes = (general = getActivitySettings().general) => MEETING_TYPE_KEYS.filter((t) => general.meetingTypes[t]);
