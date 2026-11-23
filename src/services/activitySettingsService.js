import { supabase } from '../lib/supabase';
import { systemAuditLogService } from './systemAuditLogService';
import { settingsFromRows } from '../utils/activitySettings';

/**
 * Settings > Activities (#1064): one row per Activity type plus one row of general settings. Everyone signed
 * in reads them; only HR and Super Admins change them (the database refuses anyone else, and an update it
 * filters out comes back with no rows, which this turns into a plain message). Every change is written to the
 * Activity Log under HR_SETTINGS, one line per setting changed, the way Venue changes are.
 */

const NOT_ALLOWED = 'Only HR and Super Admins can change Activity settings.';
const TYPE_COLUMNS = { name: 'name', color: 'color', active: 'active', whoFiles: 'who_files', needsHr: 'needs_hr', multiDay: 'multi_day', alsoAllowed: 'also_allowed' };
const GENERAL_COLUMNS = {
  earliestStart: 'earliest_start',
  latestEnd: 'latest_end',
  timeStep: 'time_step_minutes',
  defaultStart: 'default_start',
  defaultEnd: 'default_end',
  reminderMinutes: 'reminder_minutes',
  maxDays: 'max_days',
  guestsAllowed: 'guests_allowed',
};
const MEETING_COLUMNS = { ONSITE: 'meeting_onsite', ONLINE: 'meeting_online', HYBRID: 'meeting_hybrid' };

const WHO = { EVERYONE: 'everyone', HEADS: 'department heads only' };
const onOff = (v) => (v ? 'on' : 'off');

/** One plain sentence per changed type setting. `from` is the type before the change, `to` after. */
export function describeTypeChange(field, from, to, names = {}) {
  const name = from.name;
  switch (field) {
    case 'name': return `Renamed Activity type "${from.name}" to "${to.name}"`;
    case 'color': return `Changed the colour of "${name}" from ${from.color} to ${to.color}`;
    case 'active': return `Switched ${onOff(to.active)} Activity type "${name}"`;
    case 'whoFiles': return `"${name}" can now be filed by ${WHO[to.whoFiles]} (was ${WHO[from.whoFiles]})`;
    case 'needsHr': return `"${name}" ${to.needsHr ? 'now waits for HR' : 'no longer waits for HR'}`;
    case 'alsoAllowed': {
      const who = (ids) => ids.map((id) => names[id] || 'an unknown person').join(', ');
      const added = to.alsoAllowed.filter((id) => !from.alsoAllowed.includes(id));
      const removed = from.alsoAllowed.filter((id) => !to.alsoAllowed.includes(id));
      const parts = [added.length && `added ${who(added)}`, removed.length && `removed ${who(removed)}`].filter(Boolean).join('; ');
      return `"${name}" Also allowed: ${parts || 'changed'}`;
    }
    case 'multiDay': return `"${name}" ${to.multiDay ? 'can now run over several days' : 'now runs on one day only'}`;
    default: return `Changed ${field} of "${name}"`;
  }
}

const GENERAL_LABEL = {
  earliestStart: 'Earliest start',
  latestEnd: 'Latest end',
  timeStep: 'Time step (minutes)',
  defaultStart: 'Default start',
  defaultEnd: 'Default end',
  reminderMinutes: 'Reminder (minutes before the start)',
  maxDays: 'Longest range (days)',
};

/** One plain sentence per changed general setting. */
export function describeGeneralChange(field, from, to) {
  if (field === 'guestsAllowed') return `Guests are now ${to.guestsAllowed ? 'allowed' : 'not allowed'} on Activities`;
  if (field === 'meetingTypes') {
    return Object.keys(MEETING_COLUMNS)
      .filter((k) => from.meetingTypes[k] !== to.meetingTypes[k])
      .map((k) => `Switched ${onOff(to.meetingTypes[k])} the ${k.charAt(0)}${k.slice(1).toLowerCase()} meeting type`)
      .join('; ');
  }
  return `${GENERAL_LABEL[field] ?? field}: ${from[field]} to ${to[field]}`;
}

function refuse(error) {
  if (error.code === '23514') throw new Error('Those values do not fit together. Check the hours, the time step and the default times.');
  throw new Error(error.message);
}

/** Employee names by id, for the Activity Log. A failed read leaves the names out rather than failing the save. */
async function employeeNames(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const { data, error } = await supabase.from('employees').select('id, name').in('id', unique);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((e) => [e.id, e.name]));
}

async function audit(entityId, content, actorId, metadata) {
  await systemAuditLogService.addSystemEvent('HR_SETTINGS', entityId, content, { event: 'ACTIVITY_SETTINGS_CHANGED', ...metadata }, actorId);
}

export const activitySettingsService = {
  /** Both tables read as the app's shape. A failed read throws; callers keep the defaults. */
  async get() {
    const [types, general] = await Promise.all([
      supabase.from('activity_type_settings').select('*'),
      supabase.from('activity_general_settings').select('*').limit(1),
    ]);
    if (types.error) throw types.error;
    if (general.error) throw general.error;
    return settingsFromRows(types.data ?? [], general.data?.[0] ?? null);
  },

  /**
   * Saves the changes to one Activity type. `from` is the type as it was, `changes` the fields to set.
   * Only fields that differ are written, and each one is logged.
   */
  async saveType(typeKey, from, changes, actorId) {
    const same = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b);
    const diff = Object.keys(changes).filter((k) => TYPE_COLUMNS[k] && !same(changes[k], from[k]));
    if (!diff.length) return from;
    const values = Object.fromEntries(diff.map((k) => [k, k === 'name' ? String(changes[k]).trim() : changes[k]]));
    if ('name' in values && !values.name) throw new Error('Give the type a name.');
    const row = Object.fromEntries(diff.map((k) => [TYPE_COLUMNS[k], values[k]]));
    const { data, error } = await supabase.from('activity_type_settings').update(row).eq('activity_type', typeKey).select('activity_type');
    if (error) refuse(error);
    if (!data?.length) throw new Error(NOT_ALLOWED);
    const to = { ...from, ...values };
    const names = diff.includes('alsoAllowed') ? await employeeNames([...(from.alsoAllowed ?? []), ...to.alsoAllowed]) : {};
    for (const field of diff) {
      await audit(typeKey, describeTypeChange(field, from, to, names), actorId, { setting: field, activity_type: typeKey, from: from[field], to: to[field] });
    }
    return to;
  },

  /** Saves the changes to the general settings. `from` is the general settings as they were. */
  async saveGeneral(from, changes, actorId) {
    const row = {};
    const fields = [];
    for (const key of Object.keys(GENERAL_COLUMNS)) {
      if (key in changes && changes[key] !== from[key]) {
        row[GENERAL_COLUMNS[key]] = changes[key];
        fields.push(key);
      }
    }
    if (changes.meetingTypes) {
      for (const [k, col] of Object.entries(MEETING_COLUMNS)) {
        if (changes.meetingTypes[k] !== from.meetingTypes[k]) {
          row[col] = changes.meetingTypes[k];
          if (!fields.includes('meetingTypes')) fields.push('meetingTypes');
        }
      }
    }
    if (!fields.length) return from;
    const { data, error } = await supabase.from('activity_general_settings').update(row).eq('id', true).select('id');
    if (error) refuse(error);
    if (!data?.length) throw new Error(NOT_ALLOWED);
    const to = { ...from, ...changes, meetingTypes: { ...from.meetingTypes, ...(changes.meetingTypes ?? {}) } };
    for (const field of fields) {
      await audit('general', describeGeneralChange(field, from, to), actorId, { setting: field, from: from[field], to: to[field] });
    }
    return to;
  },
};
