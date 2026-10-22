/**
 * PROTOTYPE — Calendar redesign, "Calendar" (was variant A, month + day rail). Throwaway.
 *
 * The month stays the map; the selected day opens beside it instead of in a
 * pop-up. Multi-day Time Off reads as one bar across the days it covers, and
 * timed things (meetings, overtime, undertime) are one line each with their
 * start time. Weekends are narrower because the office works Monday to Friday.
 * Arrow keys move the selected day (← → a day, ↑ ↓ a week) once a day is focused.
 */
import { useEffect, useRef } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaDate, manilaTime, manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import { MEETING_STATUS_LABEL } from '@/services/meetingRequestService';
import { ENTRY_KINDS, kindOf } from '../entryKinds.jsx';
import { formatEntryTime } from '../entryFormat.js';
import { monthRange, monthWeeks } from '../monthWeeks.js';
import { entriesToBars } from '../peopleRows.js';
import { shiftDate } from '../calendarNav.js';
import { TIME_OFF, shortName, useProtoData } from './protoData.js';
import { Face, KindDot, LayerToggles, NavArrows, PendingSwitch, VenueStrip } from './protoParts.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COLS = 'repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.55fr))';
const MAX_LANES = 3;
const MAX_LINES = 3;
const LANE = '1.75rem';

const isBarEntry = (e) => TIME_OFF.has(e.kind);
const time12 = (iso) => {
  const [h, m] = manilaTime(iso).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};
const lineText = (e) =>
  e.kind === 'MEETING' ? e.title : `${shortName(e.employee?.name)} ${e.kind === 'UNDERTIME' ? 'undertime' : 'overtime'}`;

function Week({ week, entries, anchor, today, onSelect, onOpen }) {
  const ymds = week.map((d) => d.ymd);
  const bars = entriesToBars(entries.filter(isBarEntry), ymds);
  const shownBars = bars.filter((b) => b.lane < MAX_LANES);
  const lanes = Math.min(MAX_LANES, bars.reduce((n, b) => Math.max(n, b.lane + 1), 0));
  const hiddenBars = new Map();
  for (const b of bars.filter((x) => x.lane >= MAX_LANES)) {
    for (let i = ymds.indexOf(b.startYmd); i <= ymds.indexOf(b.endYmd); i++) hiddenBars.set(ymds[i], (hiddenBars.get(ymds[i]) ?? 0) + 1);
  }
  const lines = new Map(ymds.map((y) => [y, []]));
  for (const e of entries) if (!isBarEntry(e) && lines.has(e.manila_date)) lines.get(e.manila_date).push(e);
  for (const list of lines.values()) list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  return (
    <div
      className="grid border-b border-mauve-5 last:border-b-0"
      style={{ gridTemplateColumns: COLS, gridTemplateRows: `2.75rem ${lanes ? `repeat(${lanes}, ${LANE})` : ''} minmax(5.5rem, auto)` }}
    >
      {week.map((day, i) => {
        const selected = day.ymd === anchor;
        const weekend = i > 4;
        const count = entries.filter((e) => e.manila_date === day.ymd).length;
        return (
          <Button
            key={day.ymd}
            variant="ghost"
            data-day={day.ymd}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(day.ymd)}
            aria-label={`${format(day.date, 'EEEE, MMMM d')}, ${count} on the Calendar`}
            aria-pressed={selected}
            className={cn(
              'h-auto items-start justify-start rounded-none border-l border-mauve-5 p-2 first:border-l-0 hover:bg-mauve-3 focus-visible:z-20',
              weekend && 'bg-mauve-2',
              !day.inMonth && 'bg-mauve-2 text-mauve-9',
              selected && 'bg-mauve-3 shadow-[inset_0_0_0_2px_var(--color-mauve-9)]',
            )}
            style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
          >
            <span
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-full text-base font-bold tabular-nums',
                day.ymd === today ? 'bg-mauve-12 text-mauve-1' : day.inMonth ? 'text-foreground' : 'text-mauve-9',
              )}
            >
              {format(day.date, 'd')}
            </span>
          </Button>
        );
      })}

      {shownBars.map((bar) => {
        const def = kindOf(bar.kind);
        const start = ymds.indexOf(bar.startYmd);
        const end = ymds.indexOf(bar.endYmd);
        const wide = end - start >= 1;
        return (
          <Button
            key={bar.key}
            variant="ghost"
            tabIndex={-1}
            onClick={() => onOpen(bar.entry)}
            title={`${bar.entry.employee?.name} · ${def.label}${bar.pending ? ' (pending)' : ''}`}
            className={cn(
              'z-10 mx-1.5 hidden h-6 min-w-0 justify-start gap-1 rounded-md border px-2 text-[13px] font-semibold sm:flex',
              def.chip,
              bar.pending && 'border-dashed',
            )}
            style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: bar.lane + 2 }}
          >
            <span className="truncate">
              {wide ? bar.entry.employee?.name : shortName(bar.entry.employee?.name)} · {def.label}
              {bar.pending && ' · pending'}
            </span>
          </Button>
        );
      })}

      {week.map((day, i) => {
        const list = lines.get(day.ymd);
        const extra = Math.max(0, list.length - MAX_LINES) + (hiddenBars.get(day.ymd) ?? 0);
        const dots = entries.filter((e) => e.manila_date === day.ymd);
        return (
          <div key={day.ymd} className="pointer-events-none z-10 flex min-w-0 flex-col gap-0.5 px-1.5 pb-2" style={{ gridColumn: i + 1, gridRow: lanes + 2 }}>
            <div className="hidden flex-col gap-0.5 sm:flex">
              {list.slice(0, MAX_LINES).map((e) => (
                <Button
                  key={`${e.kind}-${e.id}`}
                  variant="ghost"
                  tabIndex={-1}
                  onClick={() => onOpen(e)}
                  title={`${e.title || kindOf(e.kind).label} · ${e.employee?.name} · ${formatEntryTime(e)}`}
                  className={cn('pointer-events-auto h-6 min-w-0 justify-start gap-1.5 rounded-md px-1 text-[13px] font-medium', e.status === 'PENDING' && 'italic text-muted-foreground')}
                >
                  <KindDot kind={e.kind} />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{time12(e.starts_at)}</span>
                  <span className="truncate">{lineText(e)}</span>
                </Button>
              ))}
              {extra > 0 && (
                <Button
                  variant="link"
                  tabIndex={-1}
                  onClick={() => onSelect(day.ymd)}
                  className="pointer-events-auto h-6 justify-start px-1 text-[13px] font-semibold text-muted-foreground"
                >
                  +{extra} more
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 sm:hidden">
              {dots.slice(0, 6).map((e) => (
                <KindDot key={`${e.kind}-${e.id}`} kind={e.kind} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RailSection({ title, count, children }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-baseline justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="font-mono text-sm tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

const RULER = ['8a', '10a', '12p', '2p', '4p', '6p'];

function DayRail({ ymd, entries, venues, today, onOpen, onPickSlot }) {
  const date = parseManilaDate(ymd);
  const day = entries.filter((e) => e.manila_date === ymd);
  const out = day.filter((e) => TIME_OFF.has(e.kind) || e.kind === 'UNDERTIME');
  const meetings = day.filter((e) => e.kind === 'MEETING').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const overtime = day.filter((e) => e.kind === 'OVERTIME');

  return (
    <aside className="flex flex-col gap-7 rounded-2xl border border-mauve-5 bg-card p-6 xl:sticky xl:top-4" data-testid="day-rail" aria-live="polite">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-base font-semibold text-muted-foreground">
            {format(date, 'EEEE')}
            {ymd === today && <span className="rounded-full bg-mauve-12 px-2.5 py-0.5 text-xs font-bold text-mauve-1">Today</span>}
          </p>
          <h2 className="text-3xl font-black tracking-tight">{format(date, 'MMMM d')}</h2>
        </div>
        {onPickSlot && (
          <Button variant="outline" onClick={() => onPickSlot({ date: ymd })}>
            <CalendarPlus size={16} />
            Book a room
          </Button>
        )}
      </header>

      <RailSection title="Out of office" count={out.length}>
        {out.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">Everyone is in.</p>
        ) : (
          <ul className="flex flex-col">
            {out.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <Button variant="ghost" onClick={() => onOpen(e)} className="h-auto w-full justify-start gap-3 px-2 py-2">
                  <Face person={e.employee} className="size-9 text-xs" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-semibold">{e.employee?.name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{e.employee?.department}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold', kindOf(e.kind).chip, e.status === 'PENDING' && 'border-dashed')}>
                    {kindOf(e.kind).label}
                    {e.kind === 'UNDERTIME' && ` from ${time12(e.starts_at)}`}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Rooms" count={meetings.length}>
        <div className="flex flex-col gap-5">
          {venues.map((v) => {
            const here = meetings.filter((m) => m.venue === v.name);
            return (
              <div key={v.id} className="flex flex-col gap-2">
                <span className="flex items-baseline justify-between text-[15px] font-semibold">
                  {v.name}
                  <span className="text-[13px] font-medium text-muted-foreground">{here.length ? `${here.length} booked` : 'Free all day'}</span>
                </span>
                <VenueStrip venue={v} meetings={here} ymd={ymd} onOpen={onOpen} onPickSlot={onPickSlot} />
                <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                  {RULER.map((r) => (
                    <span key={r}>{r}</span>
                  ))}
                </div>
                {here.map((m) => (
                  <Button key={m.id} variant="ghost" onClick={() => onOpen(m)} className="h-auto justify-start gap-3 px-2 py-1.5 text-left">
                    <span className="w-28 shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                      {time12(m.starts_at)}–{time12(m.ends_at)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[15px] font-medium', m.status === 'PENDING' && 'italic text-muted-foreground')}>{m.title}</span>
                      {m.status === 'PENDING' && (
                        <span className="block text-xs text-amber-11">{MEETING_STATUS_LABEL[m.details?.stage] ?? 'Pending'}</span>
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            );
          })}
        </div>
      </RailSection>

      <RailSection title="Overtime" count={overtime.length}>
        {overtime.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">No overtime filed.</p>
        ) : (
          overtime.map((e) => (
            <Button key={e.id} variant="ghost" onClick={() => onOpen(e)} className="h-auto justify-start gap-3 px-2 py-1.5">
              <KindDot kind="OVERTIME" />
              <span className="flex-1 truncate text-left text-[15px] font-medium">{e.employee?.name}</span>
              <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                {time12(e.starts_at)}–{time12(e.ends_at)}
              </span>
            </Button>
          ))
        )}
      </RailSection>
    </aside>
  );
}

export function KindKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground" aria-label="Colour key">
      {Object.entries(ENTRY_KINDS).map(([kind, def]) => (
        <span key={kind} className="flex items-center gap-1.5">
          <KindDot kind={kind} />
          {def.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded border border-dashed border-mauve-9" />
        Pending
      </span>
    </div>
  );
}

const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export default function VariantMonthRail({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onPickSlot, onOpen }) {
  const { from, to } = monthRange(anchor);
  const { entries, all, venues, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const weeks = monthWeeks(anchor);
  const grid = useRef(null);
  const keyed = useRef(false);

  // After an arrow key moves the day, keep focus on the newly selected day.
  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    grid.current?.querySelector(`[data-day="${anchor}"]`)?.focus();
  }, [anchor, isLoading]);

  const onKeyDown = (e) => {
    const by = STEP[e.key];
    if (!by || !e.target.dataset?.day) return;
    e.preventDefault();
    e.stopPropagation();
    keyed.current = true;
    go(manilaDate(addDays(parseManilaDate(anchor), by)));
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h2 className="min-w-52 text-3xl font-black tracking-tight">{format(parseManilaDate(anchor), 'MMMM yyyy')}</h2>
          <NavArrows unit="month" onPrev={() => go(shiftDate('month', anchor, -1))} onNext={() => go(shiftDate('month', anchor, 1))} onToday={() => go(today)} />
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
          <>
            <div ref={grid} onKeyDown={onKeyDown} className="overflow-hidden rounded-2xl border border-mauve-5 bg-background" role="group" aria-label="Month">
              <div className="grid border-b border-mauve-5 bg-mauve-2" style={{ gridTemplateColumns: COLS }}>
                {WEEKDAYS.map((d) => (
                  <div key={d} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>
              {weeks.map((week) => (
                <Week key={week[0].ymd} week={week} entries={entries} anchor={anchor} today={today} onSelect={go} onOpen={onOpen} />
              ))}
            </div>
            <KindKey />
          </>
        )}
      </section>
      <DayRail ymd={anchor} entries={entries} venues={venues} today={today} onOpen={onOpen} onPickSlot={onPickSlot} />
    </div>
  );
}
