/**
 * PROTOTYPE — Calendar redesign, variant B "Agenda ledger". Throwaway.
 *
 * List first: the next two weeks read top to bottom like a logbook, one line
 * per thing, times in a column. A small month on the left jumps around and
 * shows how busy each day is. Multi-day Time Off is written once, on its first
 * day, and after that only as "still out".
 */
import { addDays, format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaDate, manilaTime, manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import { MEETING_STATUS_LABEL } from '@/services/meetingRequestService';
import { kindOf } from '../entryKinds.jsx';
import { monthRange, monthWeeks } from '../monthWeeks.js';
import { shiftDate } from '../calendarNav.js';
import { TIME_OFF, shortName, useProtoData } from './protoData.js';
import { Face, KindDot, LayerToggles, PendingSwitch, VenueStrip } from './protoParts.jsx';

const SPAN_DAYS = 14;
const t12 = (iso) => {
  const [h, m] = manilaTime(iso).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
};
const ampm = (iso) => (Number(manilaTime(iso).slice(0, 2)) < 12 ? 'AM' : 'PM');

function MiniMonth({ anchor, entries, today, go }) {
  const weeks = monthWeeks(anchor);
  const kindsByDay = new Map();
  for (const e of entries) {
    const set = kindsByDay.get(e.manila_date) ?? new Set();
    set.add(kindOf(e.kind)?.layer);
    kindsByDay.set(e.manila_date, set);
  }
  const LAYER_ORDER = [
    ['meetings', 'bg-teal-9'],
    ['timeOff', 'bg-pink-9'],
    ['overtime', 'bg-violet-9'],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-black tracking-tight">{format(parseManilaDate(anchor), 'MMMM yyyy')}</span>
        <span className="flex">
          <Button variant="ghost" size="icon-xs" aria-label="Previous month" onClick={() => go(shiftDate('month', anchor, -1))}>
            <ChevronLeft size={14} />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next month" onClick={() => go(shiftDate('month', anchor, 1))}>
            <ChevronRight size={14} />
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="py-1 text-[10px] font-bold text-mauve-9">
            {d}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const selected = day.ymd === anchor;
          const layers = kindsByDay.get(day.ymd);
          return (
            <Button
              key={day.ymd}
              variant="ghost"
              onClick={() => go(day.ymd)}
              aria-label={format(day.date, 'EEEE, MMMM d')}
              aria-pressed={selected}
              className={cn(
                'h-9 flex-col gap-0.5 rounded-lg p-0 text-xs font-semibold tabular-nums',
                !day.inMonth && 'text-mauve-8',
                day.ymd === today && !selected && 'ring-1 ring-inset ring-mauve-8',
                selected && 'bg-mauve-12 text-mauve-1 hover:bg-mauve-12 hover:text-mauve-1',
              )}
            >
              {format(day.date, 'd')}
              <span className="flex h-1 gap-0.5">
                {LAYER_ORDER.filter(([k]) => layers?.has(k)).map(([k, c]) => (
                  <span key={k} className={cn('size-1 rounded-full', selected ? 'bg-mauve-1' : c)} />
                ))}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Runs of consecutive dates per Time Off request: first date, last date, and how many days. */
function timeOffRuns(entries) {
  const groups = new Map();
  for (const e of entries.filter((x) => TIME_OFF.has(x.kind))) {
    const key = `${e.kind}:${e.group_id ?? e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const byEntry = new Map();
  for (const list of groups.values()) {
    const dates = list.map((e) => e.manila_date).sort();
    for (const e of list) byEntry.set(e, { first: dates[0], last: dates[dates.length - 1], days: dates.length });
  }
  return byEntry;
}

function Line({ entry, run, onOpen }) {
  const def = kindOf(entry.kind);
  const pending = entry.status === 'PENDING';
  const d = entry.details ?? {};
  const meeting = entry.kind === 'MEETING';
  const allDay = entry.all_day;
  return (
    <li>
      <Button
        variant="ghost"
        onClick={() => onOpen(entry)}
        className="grid h-auto w-full grid-cols-[4.5rem_1fr_auto] items-center gap-x-4 rounded-lg px-3 py-2 text-left sm:grid-cols-[5.5rem_1fr_auto]"
      >
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {allDay ? (
            'All day'
          ) : (
            <>
              <span className="font-semibold text-foreground">{t12(entry.starts_at)}</span>
              <span className="text-[10px]"> {ampm(entry.starts_at)}</span>
              <span className="block text-[11px]">to {t12(entry.ends_at)}</span>
            </>
          )}
        </span>
        <span className="flex min-w-0 items-start gap-2.5">
          <KindDot kind={entry.kind} className="mt-1.5" />
          <span className="min-w-0">
            <span className={cn('block truncate text-sm font-semibold', pending && 'text-muted-foreground')}>
              {meeting ? entry.title : `${entry.employee?.name}`}
              {!meeting && <span className="font-medium text-muted-foreground"> · {def.label}</span>}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {meeting
                ? `${entry.venue} · ${d.facilitator?.name ?? entry.employee?.name}${d.participants?.length ? ` + ${d.participants.length}` : ''}`
                : run && run.days > 1
                  ? `${format(parseManilaDate(run.first), 'EEE MMM d')} to ${format(parseManilaDate(run.last), 'EEE MMM d')} · ${run.days} days`
                  : `${entry.employee?.department ?? ''}${entry.hours ? ` · ${entry.hours} h` : ''}`}
            </span>
          </span>
        </span>
        {pending ? (
          <span className="rounded-full border border-dashed border-amber-8 px-2 py-0.5 text-label font-bold uppercase tracking-wider text-amber-12">
            {meeting ? MEETING_STATUS_LABEL[d.stage] : 'Pending'}
          </span>
        ) : (
          <span />
        )}
      </Button>
    </li>
  );
}

function DayBlock({ ymd, entries, runs, today, onOpen, firstVisible }) {
  const date = parseManilaDate(ymd);
  const day = entries.filter((e) => e.manila_date === ymd);
  // A multi-day request is written in full on its first day (or the first day shown); after that it only joins "still out".
  const isFresh = (e) => !TIME_OFF.has(e.kind) || firstVisible || runs.get(e)?.first === ymd;
  const fresh = day.filter(isFresh);
  const continuing = day.filter((e) => !isFresh(e));
  const timed = fresh.sort((a, b) => Number(!a.all_day) - Number(!b.all_day) || String(a.starts_at).localeCompare(String(b.starts_at)));
  const weekend = [0, 6].includes(date.getDay());
  if (weekend && day.length === 0) return null;
  const meetings = day.filter((e) => e.kind === 'MEETING').length;
  const out = day.filter((e) => TIME_OFF.has(e.kind)).length;

  return (
    <section data-testid={`ledger-${ymd}`}>
      <header className="sticky top-0 z-10 flex items-baseline gap-3 border-b border-mauve-5 bg-background/95 px-3 py-2.5 backdrop-blur-sm">
        <span className={cn('text-lg font-black tracking-tight', ymd === today && 'underline decoration-2 underline-offset-4')}>
          {format(date, 'EEE d')}
        </span>
        <span className="text-sm font-medium text-muted-foreground">{format(date, 'MMMM')}</span>
        {ymd === today && <span className="rounded-full bg-mauve-12 px-2 py-0.5 text-[10px] font-bold text-mauve-1">Today</span>}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {meetings} mtg · {out} out
        </span>
      </header>
      {timed.length === 0 && continuing.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="flex flex-col py-1">
          {timed.map((e) => (
            <Line key={`${e.kind}-${e.id}`} entry={e} run={runs.get(e)} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {continuing.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-3 text-xs text-muted-foreground">
          <span className="font-semibold">Still out:</span>
          {continuing.map((e) => (
            <Button key={`${e.kind}-${e.id}`} variant="link" size="xs" onClick={() => onOpen(e)} className="h-auto p-0 text-xs text-muted-foreground">
              {shortName(e.employee?.name)} ({kindOf(e.kind).label})
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function Glance({ ymd, entries, venues, onOpen, onPickSlot }) {
  const out = entries.filter((e) => e.manila_date === ymd && TIME_OFF.has(e.kind));
  const meetings = entries.filter((e) => e.manila_date === ymd && e.kind === 'MEETING');
  return (
    <div className="grid gap-5 rounded-2xl border border-mauve-5 bg-card p-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <span className="text-label font-bold uppercase tracking-wider text-muted-foreground">Out on {format(parseManilaDate(ymd), 'MMM d')}</span>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-black tabular-nums tracking-tight">{out.length}</span>
          <span className="flex -space-x-2">
            {out.slice(0, 6).map((e) => (
              <Button key={`${e.kind}-${e.id}`} variant="ghost" size="icon-sm" className="rounded-full p-0" onClick={() => onOpen(e)} aria-label={e.employee?.name}>
                <Face person={e.employee} />
              </Button>
            ))}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground">{out.map((e) => shortName(e.employee?.name)).join(', ') || 'Everyone is in.'}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="flex justify-between text-label font-bold uppercase tracking-wider text-muted-foreground">
          Rooms <span className="font-mono normal-case tracking-normal">8a · 1p · 7p</span>
        </span>
        {venues.map((v) => (
          <div key={v.id} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
            <span className="truncate text-xs font-semibold">{v.name}</span>
            <VenueStrip venue={v} meetings={meetings.filter((m) => m.venue === v.name)} ymd={ymd} onOpen={onOpen} onPickSlot={onPickSlot} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VariantLedger({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onPickSlot, onOpen }) {
  const month = monthRange(anchor);
  const spanEnd = manilaDate(addDays(parseManilaDate(anchor), SPAN_DAYS - 1));
  const from = month.from < anchor ? month.from : anchor;
  const to = month.to > spanEnd ? month.to : spanEnd;
  const { entries, all, venues, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const runs = timeOffRuns(entries);
  const days = Array.from({ length: SPAN_DAYS }, (_, i) => manilaDate(addDays(parseManilaDate(anchor), i)));

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 lg:sticky lg:top-4">
        <MiniMonth anchor={anchor} entries={entries} today={today} go={go} />
        <Button variant="outline" size="sm" onClick={() => go(today)} className="w-full">
          Jump to today
        </Button>
        <div className="flex flex-col gap-2">
          <span className="text-label font-bold uppercase tracking-wider text-muted-foreground">Show</span>
          <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} stacked />
          <PendingSwitch canSeePending={canSeePending} showPending={showPending} setShowPending={setShowPending} />
        </div>
      </aside>
      <section className="flex min-w-0 flex-col gap-6">
        {error ? (
          <QueryError onRetry={refetch} />
        ) : isLoading ? (
          <PageLoading />
        ) : (
          <>
            <Glance ymd={anchor} entries={entries} venues={venues} onOpen={onOpen} onPickSlot={onPickSlot} />
            <div className="flex flex-col gap-2">
              {days.map((ymd) => (
                <DayBlock key={ymd} ymd={ymd} entries={entries} runs={runs} today={today} onOpen={onOpen} firstVisible={ymd === anchor} />
              ))}
              <Button variant="ghost" onClick={() => go(manilaDate(addDays(parseManilaDate(anchor), SPAN_DAYS)))} className="self-start">
                Next two weeks
                <ChevronRight size={14} />
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
