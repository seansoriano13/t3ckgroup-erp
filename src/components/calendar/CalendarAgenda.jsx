import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { activityTypeOf, styleOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { monthWeeks } from './monthWeeks.js';
import { shortName } from './entrySpan.js';
import { KindDot } from './calendarParts.jsx';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const lineText = (e) => {
  const who = shortName(e.employee?.name);
  if (e.kind === 'MEETING') return e.title;
  if (e.kind === 'UNDERTIME' || e.kind === 'OVERTIME') return `${who} ${e.kind === 'UNDERTIME' ? 'undertime' : 'overtime'}`;
  return `${who} · ${styleOf(e)?.label ?? ''}`;
};

const dayName = (ymd) => format(parseManilaDate(ymd), 'EEE, MMM d');

/**
 * The phone's Calendar, like Google Calendar's: a small month with a dot on each
 * day that has entries (coloured by kind), and under it the list of the selected
 * day. Tapping a day shows its list; tapping an entry opens its details. The
 * month never overflows the screen, and the Gantt is not offered here.
 *
 *   selectedYmd  the highlighted day, whose entries are listed
 *   onSelectDay  a day was tapped
 */
export default function CalendarAgenda({ anchor, entries, onOpenEntry, todayYmd, selectedYmd = null, onSelectDay = null, loading = null }) {
  const weeks = monthWeeks(anchor);
  const dayList = (selectedYmd ? entries.filter((e) => e.manila_date === selectedYmd) : []).sort((a, b) =>
    String(a.starts_at).localeCompare(String(b.starts_at)),
  );

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
              const dots = [...new Map(here.map((e) => [`${e.kind}-${activityTypeOf(e)}`, e])).values()].slice(0, 3);
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
                    {dots.map((e) => (
                      <KindDot key={`${e.kind}-${e.id}`} kind={e.kind} entry={e} className="size-1.5" />
                    ))}
                  </span>
                </Button>
              );
            })}
          </div>
        ))}
      </div>

      {loading ?? (
        <section aria-label="Selected day" data-testid="agenda-day" className="rounded-xl border border-mauve-5 bg-card">
          <h3 className="flex h-9 items-center gap-2 px-3 text-sm font-bold">
            {selectedYmd && dayName(selectedYmd)}
            {selectedYmd === todayYmd && <span className="rounded-full bg-mauve-12 px-2 text-xs font-bold text-mauve-1">Today</span>}
          </h3>
          {dayList.length === 0 ? (
            <p className="border-t border-mauve-5 px-3 py-3 text-sm text-muted-foreground">Nothing on the Calendar this day.</p>
          ) : (
            <ul className="flex flex-col border-t border-mauve-5" aria-label="Entries">
              {dayList.map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  <Button
                    variant="ghost"
                    onClick={() => onOpenEntry(e)}
                    className={cn('h-auto w-full justify-start gap-2 px-3 py-2 text-left', e.status === 'PENDING' && 'italic text-muted-foreground')}
                  >
                    <KindDot kind={e.kind} entry={e} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{lineText(e)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {styleOf(e)?.label} · {formatEntryTime(e)}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
