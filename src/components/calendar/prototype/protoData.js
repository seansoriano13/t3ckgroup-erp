/**
 * PROTOTYPE — Calendar redesign (branch prototype/calendar-redesign). Throwaway.
 *
 * The data every variant shares: the real `calendar_entries()` read, or a
 * deterministic sample month in the same shape (so a quiet staging month still
 * shows what a busy one looks like). Sample entries carry `sample: true` and
 * never reach a mutation.
 */
import { useQuery } from '@tanstack/react-query';
import { addDays, getDay } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { getPermissionContext } from '@/utils/permissions';
import { manilaDate, parseManilaDate } from '@/lib/manilaDate.js';
import { visibleEntries } from '../entryKinds.jsx';

const PEOPLE = [
  ['Andrea Villanueva', 'Sales'],
  ['Benjie Ramos', 'Sales'],
  ['Carla Mendoza', 'Sales'],
  ['Dennis Uy', 'Sales'],
  ['Ella Santos', 'Operations'],
  ['Francis Lim', 'Operations'],
  ['Grace Tan', 'Operations'],
  ['Hector Cruz', 'Purchasing'],
  ['Ivy Navarro', 'Purchasing'],
  ['Jun Reyes', 'Finance & Accounting'],
  ['Kat Bautista', 'Finance & Accounting'],
  ['Leo Garcia', 'HR'],
  ['Mika Aquino', 'HR'],
  ['Nico Fernandez', 'IT'],
  ['Olive Castro', 'IT'],
  ['Paolo Dizon', 'Management'],
].map(([name, department], i) => ({ id: `sample-${i}`, name, department, avatar: null }));

const PURPOSES = [
  'Weekly sales huddle',
  'Q4 pipeline review',
  'Supplier call: PO follow-ups',
  'IPAS cycle check',
  'New hire orientation',
  'HR policy briefing',
  'Odoo sync walkthrough',
  'Client demo prep',
  'Budget review',
  'Commission Pool Q&A',
];

export const SAMPLE_VENUES = [
  { id: 'sample-v1', name: 'Conference Room' },
  { id: 'sample-v2', name: 'Training Room' },
];

/** Small seeded PRNG so a month always draws the same sample. */
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const iso = (ymd, hhmm) => `${ymd}T${hhmm}:00+08:00`;
const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const isWeekday = (ymd) => {
  const d = getDay(parseManilaDate(ymd));
  return d !== 0 && d !== 6;
};

function monthDays(ym) {
  const out = [];
  let d = parseManilaDate(`${ym}-01`);
  while (manilaDate(d).slice(0, 7) === ym) {
    out.push(manilaDate(d));
    d = addDays(d, 1);
  }
  return out;
}

function sampleMonth(ym, venueNames) {
  const rand = rng(ym);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const days = monthDays(ym).filter(isWeekday);
  const out = [];
  let n = 0;
  const id = () => `${ym}-${n++}`;

  // Time Off: multi-day SIL runs, single Offset and LWOP days, short undertime.
  for (let i = 0; i < 14; i++) {
    const person = pick(PEOPLE);
    const kind = pick(['SIL', 'SIL', 'SIL', 'OFFSET', 'OFFSET', 'LWOP', 'UNDERTIME']);
    const start = Math.floor(rand() * days.length);
    const len = kind === 'SIL' ? 1 + Math.floor(rand() * 4) : kind === 'LWOP' ? 1 + Math.floor(rand() * 2) : 1;
    const group = id();
    const status = rand() < 0.2 ? 'PENDING' : 'APPROVED';
    for (const ymd of days.slice(start, start + len)) {
      const under = kind === 'UNDERTIME';
      out.push({
        id: id(),
        sample: true,
        kind,
        status,
        employee: person,
        all_day: !under,
        starts_at: iso(ymd, under ? '15:00' : '08:00'),
        ends_at: iso(ymd, '17:00'),
        manila_date: ymd,
        group_id: group,
        hours: under ? 2 : 8,
        venue: null,
        title: null,
        details: { reason: pick(['Family matter', 'Medical check-up', 'Personal errand', 'Out of town']) },
      });
    }
  }

  // Overtime: evenings.
  for (let i = 0; i < 12; i++) {
    const person = pick(PEOPLE);
    const ymd = pick(days);
    const end = 19 * 60 + Math.floor(rand() * 4) * 30;
    out.push({
      id: id(),
      sample: true,
      kind: 'OVERTIME',
      status: rand() < 0.2 ? 'PENDING' : 'APPROVED',
      employee: person,
      all_day: false,
      starts_at: iso(ymd, '17:00'),
      ends_at: iso(ymd, hm(end)),
      manila_date: ymd,
      group_id: null,
      hours: (end - 17 * 60) / 60,
      venue: null,
      title: null,
      details: { reason: pick(['Month-end close', 'Delivery cut-off', 'Client deadline']) },
    });
  }

  // Meetings: up to three per day per Venue, never overlapping at the same Venue.
  for (const ymd of days) {
    for (const venue of venueNames) {
      let cursor = 9 * 60;
      const count = Math.floor(rand() * 3.2);
      for (let k = 0; k < count; k++) {
        cursor += Math.floor(rand() * 4) * 30;
        const len = 30 * (1 + Math.floor(rand() * 4));
        if (cursor + len > 18 * 60) break;
        const facilitator = pick(PEOPLE);
        const participants = PEOPLE.filter((p) => p !== facilitator && rand() < 0.2).slice(0, 5);
        const stage = rand() < 0.15 ? 'PENDING_HR' : 'APPROVED';
        const purpose = pick(PURPOSES);
        out.push({
          id: id(),
          sample: true,
          kind: 'MEETING',
          status: stage === 'APPROVED' ? 'APPROVED' : 'PENDING',
          employee: facilitator,
          all_day: false,
          starts_at: iso(ymd, hm(cursor)),
          ends_at: iso(ymd, hm(cursor + len)),
          manila_date: ymd,
          group_id: null,
          hours: null,
          venue,
          title: purpose,
          details: { purpose, venue, stage, facilitator, participants, guests: rand() < 0.2 ? ['Guest from client'] : [] },
        });
        cursor += len;
      }
    }
  }
  return out;
}

/** Sample entries overlapping [from, to], drawn month by month so they never shift between views. */
export function sampleEntries(from, to, venueNames) {
  const months = new Set();
  for (let d = parseManilaDate(from); manilaDate(d) <= to; d = addDays(d, 1)) months.add(manilaDate(d).slice(0, 7));
  return [...months].flatMap((ym) => sampleMonth(ym, venueNames)).filter((e) => e.manila_date >= from && e.manila_date <= to);
}

/**
 * The shared read. `layers` comes from the host; pending entries arrive only
 * for viewers who may see them and only when asked.
 */
export function useProtoData({ from, to, layers, showPending, sample }) {
  const { user } = useAuth();
  const ctx = getPermissionContext(user);
  const canSeePending = ctx.isHr || ctx.isSuperAdmin || ctx.canManageLeaves;
  const includePending = canSeePending && showPending;

  const { data: realVenues = [] } = useQuery({
    queryKey: ['calendar-venues'],
    queryFn: () => meetingRequestService.listVenues(),
  });
  const venues = realVenues.length ? realVenues : SAMPLE_VENUES;

  const real = useQuery({
    queryKey: ['calendar-entries', from, to, includePending],
    queryFn: () => calendarService.fetchEntries({ from, to, includePending }),
    enabled: !sample,
  });

  let raw = sample ? sampleEntries(from, to, venues.map((v) => v.name)) : (real.data ?? []);
  if (sample && !includePending) raw = raw.filter((e) => e.status !== 'PENDING');

  return {
    entries: visibleEntries(raw, layers),
    all: raw,
    venues,
    canSeePending,
    isLoading: !sample && real.isLoading,
    error: sample ? null : real.error,
    refetch: real.refetch,
    viewerId: user?.id,
  };
}

/** Initials for a name, two letters at most. */
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** "Andrea V." */
export const shortName = (name = '') => {
  const [first, ...rest] = name.split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
};

export const TIME_OFF = new Set(['SIL', 'OFFSET', 'LWOP']);
