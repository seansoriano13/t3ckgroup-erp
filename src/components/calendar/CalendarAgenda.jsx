import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { monthWeeks } from './monthWeeks.js';
import { shortName } from './entrySpan.js';
import { KindDot } from './calendarParts.jsx';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const lineText = (e) => {
  const who = shortName(e.employee?.name);
  if (e.kind === 'MEETING') return e.title;
  if (e.kind === 'UNDERTIME' || e.kind === 'OVERTIME') return `${who} ${e.kind === 'UNDERTIME' ? 'undertime' : 'overtime'}`;
  return `${who} · ${kindOf(e.kind)?.label ?? ''}`;
};

const dayName = (ymd) => format(parseManilaDate(ymd), 'EEE, MMM d');
const shortDay = (ymd) => format(parseManilaDate(ymd), 'MMM d');

/**
 * The month's days that have entries, in order. A run of days with none is one
 * row, "No entries Nov 13-15", so the list stays short.
 */
function agendaRows(days, entries) {
  const rows = [];
  for (const day of days) {
    const list = entries
      .filter((e) => e.manila_date === day.ymd)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    if (list.length) rows.push({ type: 'day', from: day.ymd, to: day.ymd, entries: list });
    else {
      const last = rows[rows.length - 1];
      if (last?.type === 'empty') last.to = day.ymd;
      else rows.push({ type: 'empty', from: day.ymd, to: day.ymd });
    }
  }
  return rows;
}

/**
 * The phone's Calendar: a compact month strip of dots for jumping, and under it
 * an Agenda of the days that have entries. The grid never overflows the screen.
 *
 *   selectedYmd  the highlighted day
 *   onSelectDay  a strip day was tapped (the Agenda scrolls to it)
 *   onOpenDay    an Agenda day heading was tapped (opens that day's panel)
 */
export default function CalendarAgenda({ anchor, entries, onOpenEntry, todayYmd, selectedYmd = null, onSelectDay = null, onOpenDay = null, loading = null }) {
  const weeks = monthWeeks(anchor);
  const month = anchor.slice(0, 7);
  const days = weeks.flat().filter((d) => d.inMonth);
  const rows = agendaRows(days, entries);
  const list = useRef(null);

  useEffect(() => {
    if (!selectedYmd) return;
    const el = [...(list.current?.querySelectorAll('[data-from]') ?? [])].find(
      (n) => n.dataset.from <= selectedYmd && selectedYmd <= n.dataset.to,
    );
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedYmd, month]);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="calendar-agenda">
      <div className="rounded-2xl border border-mauve-5 bg-background p-1" role="group" aria-label="Month">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="py-1 text-center text-label font-bold uppercase text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].ymd} className="grid grid-cols-7">
            {week.map((day) => {
              const here = entries.filter((e) => e.manila_date === day.ymd);
              const kinds = [...new Set(here.map((e) => e.kind))].slice(0, 3);
              return (
                <Button
                  key={day.ymd}
                  variant="ghost"
                  data-testid={`day-${day.ymd}`}
                  aria-label={`${format(day.date, 'EEEE, MMMM d')}, ${here.length} on the Calendar`}
                  aria-pressed={day.ymd === selectedYmd}
                  onClick={() => onSelectDay?.(day.ymd)}
                  className={cn(
                    'h-10 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg p-0',
                    !day.inMonth && 'text-mauve-9',
                    day.ymd === selectedYmd && 'bg-mauve-3 shadow-[inset_0_0_0_2px_var(--color-mauve-9)]',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full text-sm font-bold tabular-nums',
                      day.ymd === todayYmd && 'bg-mauve-12 text-mauve-1',
                    )}
                  >
                    {format(day.date, 'd')}
                  </span>
                  <span className="flex h-1.5 gap-0.5" aria-hidden>
                    {kinds.map((k) => (
                      <KindDot key={k} kind={k} className="size-1.5" />
                    ))}
                  </span>
                </Button>
              );
            })}
          </div>
        ))}
      </div>

      {loading ?? (
        <ul ref={list} className="flex flex-col gap-2" aria-label="Agenda">
          {rows.map((row) =>
            row.type === 'empty' ? (
              <li key={row.from} data-from={row.from} data-to={row.to} className="px-1 text-sm text-muted-foreground">
                {row.from === row.to ? `No entries ${shortDay(row.from)}` : `No entries ${shortDay(row.from)}–${row.to.slice(8).replace(/^0/, '')}`}
              </li>
            ) : (
              <li key={row.from} data-from={row.from} data-to={row.to} className="rounded-xl border border-mauve-5 bg-card">
                <Button
                  variant="ghost"
                  onClick={() => onOpenDay?.(row.from)}
                  className="h-9 w-full justify-start gap-2 rounded-b-none px-3 text-sm font-bold"
                >
                  {dayName(row.from)}
                  {row.from === todayYmd && <span className="rounded-full bg-mauve-12 px-2 text-xs font-bold text-mauve-1">Today</span>}
                </Button>
                <ul className="flex flex-col border-t border-mauve-5">
                  {row.entries.map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <Button
                        variant="ghost"
                        onClick={() => onOpenEntry(e)}
                        className={cn('h-auto w-full justify-start gap-2 px-3 py-2 text-left', e.status === 'PENDING' && 'italic text-muted-foreground')}
                      >
                        <KindDot kind={e.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{lineText(e)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {kindOf(e.kind)?.label} · {formatEntryTime(e)}
                          </span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
