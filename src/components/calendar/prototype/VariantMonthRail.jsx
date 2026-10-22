/**
 * PROTOTYPE — Calendar redesign, variant A "Month + day rail". Throwaway.
 *
 * The month stays the map; the selected day opens beside it instead of in a
 * pop-up. Multi-day Time Off reads as one bar across the days it covers, and
 * timed things (meetings, overtime) are one line each with their start time.
 */
import { format } from 'date-fns';
import { CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaTime, manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from '../entryKinds.jsx';
import { formatEntryTime } from '../entryFormat.js';
import { monthRange, monthWeeks } from '../monthWeeks.js';
import { entriesToBars } from '../peopleRows.js';
import { shiftDate } from '../calendarNav.js';
import { TIME_OFF, shortName, useProtoData } from './protoData.js';
import { Face, KindDot, LayerToggles, NavArrows, PendingSwitch, VenueStrip } from './protoParts.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_LANES = 3;
const MAX_LINES = 3;
const LANE = '1.375rem';

const isBarEntry = (e) => TIME_OFF.has(e.kind);
const time12 = (iso) => {
  const [h, m] = manilaTime(iso).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
};

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
      className="grid grid-cols-7 border-b border-mauve-5 last:border-b-0"
      style={{ gridTemplateRows: `2rem ${lanes ? `repeat(${lanes}, ${LANE})` : ''} minmax(3.5rem, auto)` }}
    >
      {week.map((day, i) => {
        const selected = day.ymd === anchor;
        const weekend = i > 4;
        return (
          <Button
            key={day.ymd}
            variant="ghost"
            onClick={() => onSelect(day.ymd)}
            aria-label={format(day.date, 'EEEE, MMMM d')}
            aria-pressed={selected}
            data-testid={`day-${day.ymd}`}
            className={cn(
              'h-auto items-start justify-start rounded-none border-l border-mauve-5 p-1.5 first:border-l-0 hover:bg-mauve-3',
              weekend && 'bg-mauve-2',
              !day.inMonth && 'bg-mauve-2 text-mauve-9',
              selected && 'bg-mauve-3 shadow-[inset_0_0_0_2px_var(--color-mauve-8)]',
            )}
            style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
          >
            <span
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full text-xs font-bold tabular-nums',
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
        return (
          <Button
            key={bar.key}
            variant="ghost"
            onClick={() => onOpen(bar.entry)}
            title={`${bar.entry.employee?.name} · ${def.label}${bar.pending ? ' (pending)' : ''}`}
            className={cn(
              'z-10 mx-1 hidden h-[1.125rem] min-w-0 justify-start gap-1 rounded-md border px-1.5 text-[11px] font-semibold sm:flex',
              def.chip,
              bar.pending && 'border-dashed',
            )}
            style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: bar.lane + 2 }}
          >
            <span className="truncate">
              {shortName(bar.entry.employee?.name)} · {def.label}
            </span>
          </Button>
        );
      })}

      {week.map((day, i) => {
        const list = lines.get(day.ymd);
        const extra = Math.max(0, list.length - MAX_LINES) + (hiddenBars.get(day.ymd) ?? 0);
        const dots = entries.filter((e) => e.manila_date === day.ymd);
        return (
          <div key={day.ymd} className="pointer-events-none z-10 flex min-w-0 flex-col gap-px px-1 pb-1.5" style={{ gridColumn: i + 1, gridRow: lanes + 2 }}>
            <div className="hidden flex-col gap-px sm:flex">
              {list.slice(0, MAX_LINES).map((e) => (
                <Button
                  key={`${e.kind}-${e.id}`}
                  variant="ghost"
                  onClick={() => onOpen(e)}
                  title={`${e.title || kindOf(e.kind).label} · ${e.employee?.name} · ${formatEntryTime(e)}`}
                  className={cn('pointer-events-auto h-5 min-w-0 justify-start gap-1.5 rounded px-1 text-[11px] font-medium', e.status === 'PENDING' && 'italic text-muted-foreground')}
                >
                  <KindDot kind={e.kind} className="size-1.5" />
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{time12(e.starts_at)}</span>
                  <span className="truncate">{e.kind === 'MEETING' ? e.title : `${shortName(e.employee?.name)} ${e.kind === 'UNDERTIME' ? 'UT' : 'OT'}`}</span>
                </Button>
              ))}
              {extra > 0 && <span className="px-1 text-[11px] font-semibold text-muted-foreground">+{extra} more</span>}
            </div>
            <div className="flex flex-wrap gap-0.5 sm:hidden">
              {dots.slice(0, 6).map((e) => (
                <KindDot key={`${e.kind}-${e.id}`} kind={e.kind} className="size-1.5" />
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
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline justify-between text-label font-bold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="font-mono tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function DayRail({ ymd, entries, venues, today, onOpen, onPickSlot }) {
  const date = parseManilaDate(ymd);
  const day = entries.filter((e) => e.manila_date === ymd);
  const out = day.filter((e) => TIME_OFF.has(e.kind) || e.kind === 'UNDERTIME');
  const meetings = day.filter((e) => e.kind === 'MEETING').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const overtime = day.filter((e) => e.kind === 'OVERTIME');

  return (
    <aside className="flex flex-col gap-6 rounded-2xl border border-mauve-5 bg-card p-5 lg:sticky lg:top-4" data-testid="day-rail">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">
            {format(date, 'EEEE')}
            {ymd === today && <span className="ml-2 rounded-full bg-mauve-12 px-2 py-0.5 text-[10px] font-bold text-mauve-1">Today</span>}
          </p>
          <h2 className="text-2xl font-black tracking-tight">{format(date, 'MMMM d')}</h2>
        </div>
        {onPickSlot && (
          <Button variant="outline" size="sm" onClick={() => onPickSlot({ date: ymd })}>
            <CalendarPlus size={14} />
            Book
          </Button>
        )}
      </header>

      <RailSection title="Out" count={out.length}>
        {out.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone is in.</p>
        ) : (
          <ul className="flex flex-col">
            {out.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <Button variant="ghost" onClick={() => onOpen(e)} className="h-auto w-full justify-start gap-2.5 px-1.5 py-1.5">
                  <Face person={e.employee} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">{e.employee?.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.employee?.department}</span>
                  </span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', kindOf(e.kind).chip, e.status === 'PENDING' && 'border-dashed')}>
                    {kindOf(e.kind).label}
                    {e.kind === 'UNDERTIME' && ` ${time12(e.starts_at)}`}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>

      <RailSection title="Rooms" count={meetings.length}>
        <div className="flex flex-col gap-3">
          {venues.map((v) => {
            const here = meetings.filter((m) => m.venue === v.name);
            return (
              <div key={v.id} className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold">{v.name}</span>
                <VenueStrip venue={v} meetings={here} ymd={ymd} onOpen={onOpen} onPickSlot={onPickSlot} />
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span>8a</span>
                  <span>1p</span>
                  <span>7p</span>
                </div>
                {here.map((m) => (
                  <Button key={m.id} variant="ghost" onClick={() => onOpen(m)} className="h-auto justify-start gap-2 px-1.5 py-1 text-left">
                    <span className="w-20 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {time12(m.starts_at)}–{time12(m.ends_at)}
                    </span>
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', m.status === 'PENDING' && 'italic text-muted-foreground')}>
                      {m.title}
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
          <p className="text-sm text-muted-foreground">No overtime filed.</p>
        ) : (
          overtime.map((e) => (
            <Button key={e.id} variant="ghost" onClick={() => onOpen(e)} className="h-auto justify-start gap-2 px-1.5 py-1">
              <KindDot kind="OVERTIME" />
              <span className="flex-1 truncate text-left text-sm font-medium">{e.employee?.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatEntryTime(e)}</span>
            </Button>
          ))
        )}
      </RailSection>
    </aside>
  );
}

export default function VariantMonthRail({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onPickSlot, onOpen }) {
  const { from, to } = monthRange(anchor);
  const { entries, all, venues, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const weeks = monthWeeks(anchor);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h2 className="min-w-44 text-2xl font-black tracking-tight">{format(parseManilaDate(anchor), 'MMMM yyyy')}</h2>
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
          <div className="overflow-hidden rounded-2xl border border-mauve-5 bg-background">
            <div className="grid grid-cols-7 border-b border-mauve-5 bg-mauve-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <Week key={week[0].ymd} week={week} entries={entries} anchor={anchor} today={today} onSelect={go} onOpen={onOpen} />
            ))}
          </div>
        )}
      </section>
      <DayRail ymd={anchor} entries={entries} venues={venues} today={today} onOpen={onOpen} onPickSlot={onPickSlot} />
    </div>
  );
}
