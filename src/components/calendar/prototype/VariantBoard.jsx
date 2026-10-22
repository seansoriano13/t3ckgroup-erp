/**
 * PROTOTYPE — Calendar redesign, variant C "Who & where board". Throwaway.
 *
 * A planning board across two weeks: rows are the things people plan around
 * (each room, then each person, grouped by department), columns are days. One
 * glance answers "who is out" and "which room is free" for the fortnight.
 */
import { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaDate, manilaTime, manilaToday, parseManilaDate, weekGrid } from '@/lib/manilaDate.js';
import { formatEntryTime } from '../entryFormat.js';
import { kindOf } from '../entryKinds.jsx';
import { entriesToBars } from '../peopleRows.js';
import { TIME_OFF, useProtoData } from './protoData.js';
import { Face, LayerToggles, NavArrows, PendingSwitch } from './protoParts.jsx';

const DAYS = 14;
const NAME_W = '13rem';

function DayHeader({ days, today, outByDay }) {
  return (
    <div className="sticky top-0 z-20 flex border-b border-mauve-6 bg-mauve-2">
      <div className="sticky left-0 z-10 flex shrink-0 items-end bg-mauve-2 px-3 pb-2 text-label font-bold uppercase tracking-wider text-muted-foreground" style={{ width: NAME_W }}>
        Out of office
      </div>
      {days.map(({ ymd, date, weekend }) => {
        const out = outByDay.get(ymd) ?? 0;
        return (
          <div key={ymd} className={cn('flex min-w-[4.25rem] flex-1 flex-col items-center gap-1 border-l border-mauve-5 px-1 py-2', weekend && 'bg-mauve-3/60')}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{format(date, 'EEE')}</span>
            <span className={cn('inline-flex size-7 items-center justify-center rounded-full text-sm font-black tabular-nums', ymd === today && 'bg-mauve-12 text-mauve-1')}>
              {format(date, 'd')}
            </span>
            <span
              className={cn(
                'h-5 min-w-8 rounded-full px-1.5 text-center font-mono text-[11px] leading-5 font-semibold tabular-nums',
                out === 0 ? 'text-mauve-8' : out >= 3 ? 'bg-amber-4 text-amber-12' : 'bg-mauve-4 text-mauve-12',
              )}
              title={`${out} out`}
            >
              {out}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GroupRow({ label, count, open, onToggle }) {
  return (
    <div className="flex border-b border-mauve-5 bg-mauve-2">
      <Button
        variant="ghost"
        onClick={onToggle}
        aria-expanded={open}
        className="sticky left-0 z-10 h-8 justify-start gap-1.5 rounded-none bg-mauve-2 px-3 text-label font-bold uppercase tracking-wider text-muted-foreground"
        style={{ width: NAME_W }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
        <span className="ml-auto font-mono normal-case tracking-normal">{count}</span>
      </Button>
      <div className="flex-1" />
    </div>
  );
}

function DayCells({ days, today }) {
  return days.map(({ ymd, weekend }, i) => (
    <div
      key={ymd}
      className={cn('border-l border-mauve-5', weekend && 'bg-mauve-2', ymd === today && 'bg-mauve-3')}
      style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
    />
  ));
}

const t12 = (iso) => {
  const [h, m] = manilaTime(iso).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};

function VenueRow({ venue, days, meetings, today, onOpen, onPickSlot }) {
  return (
    <div className="flex border-b border-mauve-5">
      <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center bg-background px-3 py-2" style={{ width: NAME_W }}>
        <span className="truncate text-sm font-semibold">{venue.name}</span>
        <span className="text-[11px] text-muted-foreground">Start times</span>
      </div>
      {days.map(({ ymd, weekend }) => {
        const here = meetings
          .filter((m) => m.manila_date === ymd && m.venue === venue.name)
          .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
        return (
          <div
            key={ymd}
            className={cn('flex min-w-[4.25rem] flex-1 flex-col gap-0.5 border-l border-mauve-5 p-1', weekend && 'bg-mauve-2', ymd === today && 'bg-mauve-3')}
          >
            {here.slice(0, 3).map((m) => (
              <Button
                key={m.id}
                variant="ghost"
                onClick={() => onOpen(m)}
                title={`${m.title} · ${formatEntryTime(m)}`}
                className={cn(
                  'h-5 justify-start gap-1 rounded px-1 font-mono text-[10px] font-semibold tabular-nums',
                  m.status === 'PENDING' ? 'border border-dashed border-teal-7 text-teal-11' : 'bg-teal-3 text-teal-11 hover:bg-teal-4',
                )}
              >
                {t12(m.starts_at)}
              </Button>
            ))}
            {here.length > 3 && <span className="px-1 text-[10px] font-semibold text-muted-foreground">+{here.length - 3}</span>}
            {here.length === 0 && !weekend && onPickSlot && (
              <Button
                variant="ghost"
                onClick={() => onPickSlot({ venueId: venue.id, date: ymd })}
                aria-label={`Book ${venue.name} on ${ymd}`}
                className="h-5 rounded px-1 text-[10px] font-medium text-mauve-9 hover:text-foreground"
              >
                Free
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PersonRow({ row, days, today, onOpen }) {
  const ymds = days.map((d) => d.ymd);
  const lanes = row.bars.reduce((n, b) => Math.max(n, b.lane + 1), 1);
  return (
    <div className="flex border-b border-mauve-5 last:border-b-0">
      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 bg-background px-3 py-1.5" style={{ width: NAME_W }}>
        <Face person={row.employee} className="size-6 text-[9px]" />
        <span className="truncate text-sm font-medium">{row.employee.name}</span>
      </div>
      <div
        className="relative grid flex-1"
        style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(4.25rem, 1fr))`, gridTemplateRows: `repeat(${lanes}, 1.75rem)`, paddingBlock: 2 }}
      >
        <DayCells days={days} today={today} />
        {row.bars.map((bar) => {
          const def = kindOf(bar.kind);
          const start = ymds.indexOf(bar.startYmd);
          const end = ymds.indexOf(bar.endYmd);
          const e = bar.entry;
          const span = end - start + 1;
          const short = !TIME_OFF.has(bar.kind);
          return (
            <Button
              key={bar.key}
              variant="ghost"
              onClick={() => onOpen(e)}
              title={`${def.label}${bar.pending ? ' (pending)' : ''}`}
              className={cn(
                'z-[1] m-0.5 h-auto min-w-0 justify-start gap-1 rounded-md border px-1.5 py-0 text-[11px] font-semibold',
                def.chip,
                bar.pending && 'border-dashed',
                short && 'justify-center',
              )}
              style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: bar.lane + 1 }}
            >
              <span className="truncate">
                {short ? `${bar.kind === 'OVERTIME' ? 'OT' : 'UT'} ${e.hours ?? ''}h` : def.label}
                {span > 1 && <span className="font-medium opacity-70"> · {span} days</span>}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export default function VariantBoard({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onPickSlot, onOpen }) {
  const start = weekGrid(anchor)[0];
  const days = useMemo(
    () =>
      Array.from({ length: DAYS }, (_, i) => {
        const date = addDays(start, i);
        return { date, ymd: manilaDate(date), weekend: i % 7 > 4 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manilaDate(start)],
  );
  const from = days[0].ymd;
  const to = days[DAYS - 1].ymd;
  const { entries, all, venues, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState({});

  const meetings = entries.filter((e) => e.kind === 'MEETING');
  const outByDay = new Map();
  for (const e of entries) if (TIME_OFF.has(e.kind)) outByDay.set(e.manila_date, (outByDay.get(e.manila_date) ?? 0) + 1);

  const ymds = days.map((d) => d.ymd);
  const people = new Map();
  for (const e of entries.filter((x) => x.kind !== 'MEETING')) {
    const p = e.employee;
    if (!p?.id) continue;
    const row = people.get(p.id) ?? { employee: p, list: [] };
    row.list.push(e);
    people.set(p.id, row);
  }
  const needle = query.trim().toLowerCase();
  const departments = new Map();
  for (const { employee, list } of people.values()) {
    if (needle && !`${employee.name} ${employee.department}`.toLowerCase().includes(needle)) continue;
    const dept = employee.department || 'No department';
    const rows = departments.get(dept) ?? [];
    rows.push({ employee, bars: entriesToBars(list, ymds) });
    departments.set(dept, rows);
  }
  const groups = [...departments.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="text-2xl font-black tracking-tight">
          {format(days[0].date, 'MMM d')} <span className="text-muted-foreground">to</span> {format(days[DAYS - 1].date, 'MMM d, yyyy')}
        </h2>
        <NavArrows
          unit="week"
          onPrev={() => go(manilaDate(addDays(parseManilaDate(anchor), -7)))}
          onNext={() => go(manilaDate(addDays(parseManilaDate(anchor), 7)))}
          onToday={() => go(today)}
        />
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
          <PendingSwitch canSeePending={canSeePending} showPending={showPending} setShowPending={setShowPending} />
        </div>
      </div>

      {error ? (
        <QueryError onRetry={refetch} />
      ) : isLoading ? (
        <PageLoading />
      ) : (
        <div className="max-h-[75vh] min-w-0 overflow-auto rounded-2xl border border-mauve-6 bg-background" data-testid="board">
          <div className="w-max min-w-full">
            <DayHeader days={days} today={today} outByDay={outByDay} />

            {layers.meetings !== false && (
              <>
                <GroupRow label="Rooms" count={meetings.length} open={!closed.__rooms} onToggle={() => setClosed((c) => ({ ...c, __rooms: !c.__rooms }))} />
                {!closed.__rooms &&
                  venues.map((v) => <VenueRow key={v.id} venue={v} days={days} meetings={meetings} today={today} onOpen={onOpen} onPickSlot={onPickSlot} />)}
              </>
            )}

            <div className="flex border-b border-mauve-5">
              <div className="sticky left-0 z-10 shrink-0 bg-background p-2" style={{ width: NAME_W }}>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" icon={Search} className="h-8" />
              </div>
              <div className="flex-1" />
            </div>

            {groups.length === 0 && <p className="sticky left-0 p-6 text-sm text-muted-foreground">Nobody is out or on overtime in these two weeks.</p>}
            {groups.map(([dept, rows]) => (
              <div key={dept}>
                <GroupRow label={dept} count={rows.length} open={!closed[dept]} onToggle={() => setClosed((c) => ({ ...c, [dept]: !c[dept] }))} />
                {!closed[dept] &&
                  rows
                    .sort((a, b) => a.employee.name.localeCompare(b.employee.name))
                    .map((row) => <PersonRow key={row.employee.id} row={row} days={days} today={today} onOpen={onOpen} />)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
