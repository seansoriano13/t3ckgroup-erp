import { isIsoDate } from '@/utils/dateUtils.js';
import { manilaToday } from '@/lib/manilaDate.js';
import { timeOptions } from '@/utils/activitySettings';

/** "06:00" .. "21:45" in 15-minute steps. */
export const TIME_OPTIONS = Array.from({ length: 64 }, (_, i) => {
  const minutes = 6 * 60 + i * 15;
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { value: hhmm, label: hhmm };
});

/** A Manila wall-clock date and time as an ISO instant (Manila is a fixed UTC+8). */
export const manilaInstant = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();

const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Where a new Activity starts (#1086): the default start, or the next time slot when today's default has
 * passed, or the default start tomorrow when no slot is left today. So the form never opens in the
 * "cannot start in the past" state. `day` is a date the person already picked (a free Venue day):
 * a later day keeps the default start. `now` is the clock, so a test can fix it.
 */
export function defaultSlot(rules, now = new Date(), day = null) {
  const today = manilaToday(now);
  const wanted = day ?? today;
  if (wanted !== today) return { date: wanted, start: rules.defaultStart, end: rules.defaultEnd };
  const times = timeOptions(rules).map((o) => o.value);
  // The last time is only ever an end: a slot needs room to end after it starts.
  const start = times.slice(0, -1).find((t) => t >= rules.defaultStart && new Date(manilaInstant(today, t)) >= now);
  if (!start) return { date: manilaToday(new Date(now.getTime() + 86_400_000)), start: rules.defaultStart, end: rules.defaultEnd };
  if (start === rules.defaultStart) return { date: today, start, end: rules.defaultEnd };
  // A later start keeps the length of the default Activity, and ends no later than the day's last time.
  const wantedEnd = toMinutes(start) + toMinutes(rules.defaultEnd) - toMinutes(rules.defaultStart);
  const end = times.find((t) => toMinutes(t) >= wantedEnd) ?? times[times.length - 1];
  return { date: today, start, end };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The most characters a purpose can hold (#1087). The database holds the same limit. */
export const PURPOSE_MAX = 500;

/** A meeting link is a web link: it starts with http:// or https:// and has no spaces (#1087). The database holds the same rule. */
export const LINK_RULE = 'The meeting link must start with http:// or https://';
export const isWebLink = (link) => /^https?:\/\/\S+$/i.test(String(link ?? '').trim());

/** The latest date an Activity can be on: one year after today in Manila (#1087), as the database counts it. */
export function latestDate(now = new Date()) {
  const [y, m, d] = manilaToday(now).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate(); // 29 Feb falls back to 28 Feb, as Postgres does
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/**
 * Everything that stops a draft from being filed, as a list of { field, message } in the order the form
 * reads. `field` says which box the message belongs under: 'venue', 'link', 'date', 'dateTo', 'time',
 * 'days', 'lead', 'purpose' or 'guests'. The first one is the summary line. A new check is one more
 * `add(field, message)` at the place it belongs in the order.
 */
export function draftProblems({ activityType = 'MEETING', meetingType = 'ONSITE', meetingLink = '', venueId, date, dateTo = '', start, end, days, facilitatorId, purpose, guests = [], allowPast = false, multiDay = activityType !== 'MEETING', typeName = activityType === 'MEETING' ? 'Meeting' : 'Activity', maxDays = null }, now = new Date()) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });
  const isMeeting = activityType === 'MEETING';
  if (isMeeting && meetingType !== 'ONLINE' && !venueId) add('venue', 'Choose a Venue.');
  if (isMeeting && meetingType !== 'ONSITE') {
    if (!String(meetingLink ?? '').trim()) add('link', 'Paste the meeting link.');
    else if (!isWebLink(meetingLink)) add('link', `${LINK_RULE}.`);
  }
  const dateOk = isIsoDate(date);
  const latest = latestDate(now);
  const tooFar = 'The date can be at most one year ahead.';
  if (!dateOk) add('date', 'Choose a date.');
  else if (date > latest) add('date', tooFar);
  // "To" before "From" is said under the To box. The typed value stays until it is fixed.
  const backwards = multiDay && dateOk && isIsoDate(dateTo) && dateTo < date;
  if (backwards) add('dateTo', 'To cannot be before From.');
  else if (multiDay && isIsoDate(dateTo) && dateTo > latest) add('dateTo', tooFar);
  const timesOk = Boolean(start && end);
  if (!timesOk) add('time', 'Choose a start and end time.');
  if (dateOk && timesOk) {
    const where = days && days.length > 1 ? 'days' : 'time';
    if (days) {
      // A range: every kept day is checked. A day that has already started is not checked again.
      // A backwards To has its own message above, so the days list is not blamed for it.
      if (days.length === 0 && !backwards) add('days', 'Keep at least one day.');
      if (days.length > 1 && !multiDay) add('date', `A ${typeName} is one day.`);
      if (maxDays && days.length > 0) {
        const first = days[0].date;
        const last = days[days.length - 1].date;
        const span = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
        if (span > maxDays) add('dateTo', `An Activity can cover at most ${maxDays} days.`);
      }
      const reversed = days.find((d) => d.end <= d.start);
      if (reversed) add(where, `${reversed.date}: the Activity must end after it starts.`);
      const past = allowPast ? null : days.find((d) => !d.frozen && new Date(manilaInstant(d.date, d.start)) < now);
      if (past) add(where, `${past.date}: the Activity cannot start in the past.`);
    } else {
      if (end <= start) add('time', 'The Activity must end after it starts.');
      if (!allowPast && new Date(manilaInstant(date, start)) < now) add('time', 'The Activity cannot start in the past.');
    }
  }
  if (!facilitatorId) add('lead', 'Choose a Lead.');
  if (!purpose.trim()) add('purpose', 'Write the purpose of the Activity.');
  else if ([...purpose.trim()].length > PURPOSE_MAX) add('purpose', `The purpose can be at most ${PURPOSE_MAX} characters.`);
  const badEmail = guests.find((g) => g.email && !EMAIL.test(g.email.trim()));
  if (badEmail) add('guests', `Check the email for ${badEmail.name}.`);
  return problems;
}

/**
 * Everything an edit can change, in one comparable string (#1084). The same fields the database compares in
 * `edit_meeting_request`: type, Meeting type, link, Venue, every day and its times, Lead, Participants, Guests, purpose.
 * Pieces a type does not use (a Venue on a task, a link on an Onsite Meeting) arrive empty. `days` are
 * { startsAt, endsAt } instants in any ISO form; they are compared as moments, not as text.
 */
export function activityFingerprint({ activityType, meetingType, meetingLink, venueId, days, facilitatorId, participantIds = [], guests = [], purpose }) {
  return JSON.stringify({
    activityType,
    meetingType: activityType === 'MEETING' ? meetingType : null,
    meetingLink: String(meetingLink ?? '').trim() || null,
    venueId: venueId || null,
    days: days.map((d) => [new Date(d.startsAt).getTime(), new Date(d.endsAt).getTime()]).sort((a, b) => a[0] - b[0]),
    facilitatorId: facilitatorId || null,
    participantIds: [...participantIds].sort(),
    guests: guests.map((g) => [String(g.name ?? '').trim(), String(g.email ?? '').trim()]),
    purpose: String(purpose ?? '').trim(),
  });
}

/** Why a draft cannot be filed yet, in plain words (the first of `draftProblems`), or null. */
export const draftProblem = (draft, now) => draftProblems(draft, now)[0]?.message ?? null;
