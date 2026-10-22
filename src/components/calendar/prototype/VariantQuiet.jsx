/**
 * PROTOTYPE — Calendar redesign, variant D "Quiet list" (minimalist). Throwaway.
 *
 * No grid, no chips. The month is one column of days; each day is a single
 * sentence in plain words ("Andrea V. and Jun R. out · 3 meetings from 9:00").
 * Open a day to read every item, in place. Everything stays one click away.
 */
import { useState } from 'react';
import { format, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import { LAYERS, kindOf } from '../entryKinds.jsx';
import { formatEntryTime } from '../entryFormat.js';
import { monthWeeks } from '../monthWeeks.js';
import { shiftDate } from '../calendarNav.js';
import { TIME_OFF, shortName, useProtoData } from './protoData.js';
import { KindDot, PendingSwitch } from './protoParts.jsx';

const names = (list) => {
  const n = list.map((e) => shortName(e.employee?.name));
  if (n.length <= 2) return n.join(' and ');
  return `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
};

function summary(day) {
  const out = day.filter((e) => TIME_OFF.has(e.kind));
  const meetings = day.filter((e) => e.kind === 'MEETING').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const late = day.filter((e) => e.kind === 'OVERTIME');
  const early = day.filter((e) => e.kind === 'UNDERTIME');
  const parts = [];
  if (out.length) parts.push(`${names(out)} out`);
  if (meetings.length) parts.push(`${meetings.length} ${meetings.length === 1 ? 'meeting' : 'meetings'} from ${formatEntryTime(meetings[0]).split(' to ')[0]}`);
  if (late.length) parts.push(`${names(late)} on overtime`);
  if (early.length) parts.push(`${names(early)} leaving early`);
  return parts;
}

export default function VariantQuiet({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onOpen }) {
  const days = monthWeeks(anchor)
    .flat()
    .filter((d) => d.inMonth);
  const from = days[0].ymd;
  const to = days[days.length - 1].ymd;
  const { entries, canSeePending, isLoading, error, refetch } = useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const [open, setOpen] = useState(() => new Set([anchor]));
  const toggle = (ymd) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return next;
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h2 className="text-2xl font-black tracking-tight">{format(parseManilaDate(anchor), 'MMMM yyyy')}</h2>
        <nav className="flex gap-4 text-sm font-semibold text-muted-foreground" aria-label="Month">
          <Button variant="link" size="xs" className="h-auto p-0 text-sm text-muted-foreground" onClick={() => go(shiftDate('month', anchor, -1))}>
            Previous
          </Button>
          <Button variant="link" size="xs" className="h-auto p-0 text-sm text-muted-foreground" onClick={() => go(today)}>
            This month
          </Button>
          <Button variant="link" size="xs" className="h-auto p-0 text-sm text-muted-foreground" onClick={() => go(shiftDate('month', anchor, 1))}>
            Next
          </Button>
        </nav>
        <div className="flex flex-wrap items-center gap-4 sm:ml-auto" role="group" aria-label="Layers">
          {LAYERS.map(({ key, label }) => (
            <Button
              key={key}
              variant="link"
              size="xs"
              aria-pressed={layers[key]}
              onClick={() => toggleLayer(key)}
              className={cn('h-auto p-0 text-sm', layers[key] ? 'text-foreground underline underline-offset-4' : 'text-mauve-9 no-underline')}
            >
              {label}
            </Button>
          ))}
          <PendingSwitch canSeePending={canSeePending} showPending={showPending} setShowPending={setShowPending} />
        </div>
      </header>

      {error ? (
        <QueryError onRetry={refetch} />
      ) : isLoading ? (
        <PageLoading />
      ) : (
        <ol className="flex flex-col">
          {days.map((d) => {
            const day = entries.filter((e) => e.manila_date === d.ymd);
            const weekend = [0, 6].includes(getDay(d.date));
            if (weekend && day.length === 0) return null;
            const parts = summary(day);
            const isOpen = open.has(d.ymd);
            const past = d.ymd < today;
            const sorted = [...day].sort((a, b) => Number(!a.all_day) - Number(!b.all_day) || String(a.starts_at).localeCompare(String(b.starts_at)));
            return (
              <li key={d.ymd} className="border-b border-mauve-4 last:border-b-0">
                <Button
                  variant="ghost"
                  onClick={() => toggle(d.ymd)}
                  aria-expanded={isOpen}
                  disabled={day.length === 0}
                  className={cn(
                    'grid h-auto w-full grid-cols-[3.5rem_1fr] items-baseline gap-4 rounded-none px-1 py-4 text-left hover:bg-transparent disabled:opacity-100',
                    past && 'text-mauve-11',
                  )}
                >
                  <span className="flex flex-col">
                    <span className={cn('text-2xl font-black tabular-nums leading-none', d.ymd === today && 'underline decoration-2 underline-offset-4')}>
                      {format(d.date, 'd')}
                    </span>
                    <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{format(d.date, 'EEE')}</span>
                  </span>
                  <span className="text-[15px] leading-relaxed font-medium whitespace-normal">
                    {parts.length ? parts.join(' · ') : <span className="text-mauve-9">Nothing on.</span>}
                  </span>
                </Button>
                {isOpen && day.length > 0 && (
                  <ul className="mb-4 ml-[4.5rem] flex flex-col">
                    {sorted.map((e) => (
                      <li key={`${e.kind}-${e.id}`}>
                        <Button
                          variant="ghost"
                          onClick={() => onOpen(e)}
                          className="grid h-auto w-full grid-cols-[7.5rem_1fr] items-baseline gap-3 px-2 py-1.5 text-left"
                        >
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">{e.all_day ? 'All day' : formatEntryTime(e).replace(' to ', '–')}</span>
                          <span className="flex min-w-0 items-baseline gap-2 text-sm">
                            <KindDot kind={e.kind} className="size-1.5 translate-y-[-2px]" />
                            <span className="truncate">
                              {e.kind === 'MEETING' ? (
                                <>
                                  <span className="font-semibold">{e.title}</span>
                                  <span className="text-muted-foreground"> in {e.venue}</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-semibold">{e.employee?.name}</span>
                                  <span className="text-muted-foreground"> · {kindOf(e.kind).label}</span>
                                </>
                              )}
                              {e.status === 'PENDING' && <span className="text-muted-foreground"> (pending)</span>}
                            </span>
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
