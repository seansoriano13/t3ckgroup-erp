import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from './entryKinds.jsx';
import { monthWeeks } from './monthWeeks.js';
import { groupByPerson } from './peopleRows.js';

const DAY_W = '2.25rem';
const LANE_H = '1.5rem';

/**
 * The People view: one row per person, one column per day of the month.
 * The name column stays pinned; the day columns scroll inside this view only.
 */
export default function CalendarPeople({ anchor, entries, onOpenEntry, todayYmd }) {
  const [query, setQuery] = useState('');
  const days = useMemo(() => {
    const month = anchor.slice(0, 7);
    return monthWeeks(anchor)
      .flat()
      .filter((d) => d.ymd.slice(0, 7) === month);
  }, [anchor]);
  const ymds = useMemo(() => days.map((d) => d.ymd), [days]);
  const rows = useMemo(() => groupByPerson(entries, ymds, query), [entries, ymds, query]);
  const template = `repeat(${days.length}, ${DAY_W})`;

  return (
    <div data-testid="calendar-people" className="flex min-w-0 flex-col gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by name or department"
        aria-label="Filter people"
        className="max-w-xs"
      />
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
        <div className="w-max min-w-full">
          <div className="flex border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
            <div className="sticky left-0 z-10 w-32 shrink-0 bg-muted px-2 py-1 sm:w-44">Person</div>
            <div className="grid" style={{ gridTemplateColumns: template }}>
              {days.map((d) => (
                <div key={d.ymd} className={`py-1 text-center ${d.ymd === todayYmd ? 'text-primary' : ''}`}>
                  {format(d.date, 'd')}
                  <div className="text-[9px] font-normal">{format(d.date, 'EEEEE')}</div>
                </div>
              ))}
            </div>
          </div>
          {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nobody to show for this month.</p>}
          {rows.map(({ employee, bars, lanes }) => (
            <div key={employee.id} data-testid={`person-${employee.id}`} className="flex border-b border-border last:border-b-0">
              <div className="sticky left-0 z-10 w-32 shrink-0 bg-background px-2 py-1 sm:w-44">
                <div className="truncate text-xs font-medium">{employee.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">{employee.department}</div>
              </div>
              <div
                className="grid py-1"
                style={{ gridTemplateColumns: template, gridAutoRows: LANE_H, rowGap: '2px', minHeight: `calc(${lanes} * ${LANE_H})` }}
              >
                {bars.map((bar) => {
                  const def = kindOf(bar.kind);
                  const Icon = def.icon;
                  const start = ymds.indexOf(bar.startYmd) + 1;
                  const end = ymds.indexOf(bar.endYmd) + 2;
                  return (
                    <Button
                      variant="outline"
                      size="xs"
                      key={bar.key}
                      data-testid="people-bar"
                      data-pending={bar.pending ? 'true' : 'false'}
                      onClick={() => onOpenEntry(bar.entry)}
                      title={`${def.label}${bar.pending ? ' (pending)' : ''}: ${format(parseManilaDate(bar.startYmd), 'MMM d')}`}
                      style={{ gridColumn: `${start} / ${end}`, gridRow: bar.lane + 1 }}
                      className={`h-auto min-w-0 justify-start gap-1 rounded border px-1 py-0 text-[10px] font-medium ${def.chip} ${
                        bar.pending ? 'border-dashed opacity-70' : ''
                      }`}
                    >
                      <Icon size={10} className="shrink-0" />
                      <span className="truncate">
                        {def.label}
                        {bar.pending ? ' (pending)' : ''}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
