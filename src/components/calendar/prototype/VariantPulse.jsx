/**
 * PROTOTYPE — Calendar redesign, variant E "Pulse" (experimental). Throwaway.
 *
 * Three months as a heat map: one strip each for Out, Meetings and Overtime,
 * one square per day, darker when busier. It shows the season at a glance
 * (a heavy leave week, a quiet stretch); click a square to read that day below.
 */
import { addMonths, format, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaDate, manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from '../entryKinds.jsx';
import { formatEntryTime } from '../entryFormat.js';
import { monthWeeks } from '../monthWeeks.js';
import { shiftDate } from '../calendarNav.js';
import { TIME_OFF, useProtoData } from './protoData.js';
import { KindDot, LayerToggles, NavArrows, PendingSwitch } from './protoParts.jsx';

const ROWS = [
  { key: 'out', label: 'Out', layer: 'timeOff', match: (e) => TIME_OFF.has(e.kind), steps: ['bg-pink-3', 'bg-pink-5', 'bg-pink-7', 'bg-pink-9'] },
  { key: 'meetings', label: 'Meetings', layer: 'meetings', match: (e) => e.kind === 'MEETING', steps: ['bg-teal-3', 'bg-teal-5', 'bg-teal-7', 'bg-teal-9'] },
  { key: 'late', label: 'Overtime', layer: 'overtime', match: (e) => e.kind === 'OVERTIME', steps: ['bg-violet-3', 'bg-violet-5', 'bg-violet-7', 'bg-violet-9'] },
];
const CELL = '1.375rem';

function shade(count, max, steps) {
  if (!count) return 'bg-mauve-3';
  return steps[Math.min(steps.length - 1, Math.floor(((count - 1) / Math.max(max, 1)) * steps.length))];
}

function MonthStrip({ ym, entries, layers, anchor, today, go }) {
  const days = monthWeeks(`${ym}-01`)
    .flat()
    .filter((d) => d.inMonth);
  const counts = ROWS.map((r) => days.map((d) => entries.filter((e) => e.manila_date === d.ymd && r.match(e)).length));
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-black tracking-tight">{format(days[0].date, 'MMMM')}</h3>
      <div className="overflow-x-auto pb-1">
        <div className="grid w-max items-center gap-[3px]" style={{ gridTemplateColumns: `6rem repeat(${days.length}, ${CELL}) 3rem` }}>
          <span />
          {days.map((d) => (
            <span key={d.ymd} className={cn('text-center font-mono text-[9px] tabular-nums', [0, 6].includes(getDay(d.date)) ? 'text-mauve-8' : 'text-muted-foreground')}>
              {format(d.date, 'd')}
            </span>
          ))}
          <span />
          {ROWS.map((r, ri) => {
            if (layers[r.layer] === false) return null;
            const max = Math.max(...counts[ri]);
            const total = counts[ri].reduce((a, b) => a + b, 0);
            return [
              <span key={`${r.key}-l`} className="text-xs font-semibold text-muted-foreground">
                {r.label}
              </span>,
              ...days.map((d, di) => {
                const n = counts[ri][di];
                return (
                  <Button
                    key={`${r.key}-${d.ymd}`}
                    variant="ghost"
                    onClick={() => go(d.ymd)}
                    aria-label={`${format(d.date, 'MMM d')}: ${n} ${r.label.toLowerCase()}`}
                    title={`${format(d.date, 'EEE MMM d')}: ${n}`}
                    className={cn(
                      'rounded-[5px] p-0 hover:ring-2 hover:ring-mauve-8',
                      shade(n, max, r.steps),
                      [0, 6].includes(getDay(d.date)) && !n && 'bg-mauve-2',
                      d.ymd === anchor && 'ring-2 ring-mauve-12',
                      d.ymd === today && d.ymd !== anchor && 'ring-1 ring-mauve-10',
                    )}
                    style={{ width: CELL, height: CELL }}
                  />
                );
              }),
              <span key={`${r.key}-t`} className="pl-2 font-mono text-xs tabular-nums text-muted-foreground">
                {total}
              </span>,
            ];
          })}
        </div>
      </div>
    </section>
  );
}

function Lens({ ymd, entries, onOpen }) {
  const day = entries
    .filter((e) => e.manila_date === ymd)
    .sort((a, b) => Number(!a.all_day) - Number(!b.all_day) || String(a.starts_at).localeCompare(String(b.starts_at)));
  return (
    <section className="rounded-2xl border border-mauve-5 bg-card p-5" aria-live="polite">
      <h3 className="mb-3 text-lg font-black tracking-tight">{format(parseManilaDate(ymd), 'EEEE, MMMM d')}</h3>
      {day.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing on this day.</p>
      ) : (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {day.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <Button variant="ghost" onClick={() => onOpen(e)} className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left">
                <KindDot kind={e.kind} />
                <span className="w-24 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{e.all_day ? 'All day' : formatEntryTime(e).replace(' to ', '–')}</span>
                <span className="min-w-0 truncate text-sm font-medium">
                  {e.kind === 'MEETING' ? e.title : `${e.employee?.name} · ${kindOf(e.kind).label}`}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function VariantPulse({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onOpen }) {
  const first = parseManilaDate(`${anchor.slice(0, 7)}-01`);
  const months = [0, 1, 2].map((i) => manilaDate(addMonths(first, i)).slice(0, 7));
  const lastDays = monthWeeks(`${months[2]}-01`)
    .flat()
    .filter((d) => d.inMonth);
  const from = `${months[0]}-01`;
  const to = lastDays[lastDays.length - 1].ymd;
  const { entries, all, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="text-2xl font-black tracking-tight">
          {format(first, 'MMM')} <span className="text-muted-foreground">to</span> {format(addMonths(first, 2), 'MMM yyyy')}
        </h2>
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
          <div className="flex flex-col gap-6 rounded-2xl border border-mauve-5 p-5">
            {months.map((ym) => (
              <MonthStrip key={ym} ym={ym} entries={entries} layers={layers} anchor={anchor} today={today} go={go} />
            ))}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Quiet
              {['bg-mauve-3', 'bg-mauve-5', 'bg-mauve-7', 'bg-mauve-9', 'bg-mauve-11'].map((c) => (
                <span key={c} className={cn('size-3 rounded-[3px]', c)} />
              ))}
              Busy · the number at the end of a strip is the month&apos;s total
            </p>
          </div>
          <Lens ymd={anchor} entries={entries} onOpen={onOpen} />
        </>
      )}
    </div>
  );
}
