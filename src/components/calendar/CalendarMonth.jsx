import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { monthWeeks } from './monthWeeks.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CHIPS_PER_DAY = 3;

function EntryChip({ entry, onOpen, wide = false }) {
  const def = kindOf(entry.kind);
  const Icon = def.icon;
  const pending = entry.status === 'PENDING';
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() => onOpen(entry)}
      className={`h-auto w-full justify-start gap-1 border px-1.5 py-0.5 text-left text-[11px] font-medium ${def.chip} ${pending ? 'border-dashed opacity-80' : ''}`}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">
        {entry.employee?.name} · {def.label}
        {wide && !entry.all_day ? ` · ${formatEntryTime(entry)}` : ''}
        {pending ? ' (pending)' : ''}
      </span>
    </Button>
  );
}

/**
 * The month view: Monday-first weeks. On desktop a day shows up to three chips and
 * "+N more"; on a phone it shows a count, and tapping the cell opens the day's list.
 */
export default function CalendarMonth({ anchor, entries, onOpenEntry, todayYmd }) {
  const [dayYmd, setDayYmd] = useState(null);
  const weeks = monthWeeks(anchor);

  const byDay = new Map();
  for (const entry of entries) {
    const list = byDay.get(entry.manila_date) ?? [];
    list.push(entry);
    byDay.set(entry.manila_date, list);
  }
  const dayEntries = dayYmd ? (byDay.get(dayYmd) ?? []) : [];

  return (
    <div data-testid="calendar-month" className="min-w-0">
      <div className="grid grid-cols-7 gap-px text-center text-[11px] font-semibold text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {weeks.flat().map((day) => {
          const list = byDay.get(day.ymd) ?? [];
          const shown = list.slice(0, CHIPS_PER_DAY);
          return (
            <div
              key={day.ymd}
              data-testid={`day-${day.ymd}`}
              className={`flex min-h-16 min-w-0 flex-col gap-1 bg-background p-1 sm:min-h-28 ${day.inMonth ? '' : 'bg-muted/40 text-muted-foreground'}`}
            >
              <Button
                variant={day.ymd === todayYmd ? 'default' : 'ghost'}
                size="xs"
                className="h-5 w-fit min-w-5 px-1 text-[11px]"
                onClick={() => setDayYmd(day.ymd)}
                aria-label={`Open ${format(day.date, 'MMMM d')}`}
              >
                {format(day.date, 'd')}
              </Button>
              {list.length > 0 && (
                <Button
                  variant="secondary"
                  size="xs"
                  className="h-5 w-fit px-1.5 text-[11px] sm:hidden"
                  onClick={() => setDayYmd(day.ymd)}
                  aria-label={`${list.length} entries on ${day.ymd}`}
                >
                  {list.length}
                </Button>
              )}
              <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {shown.map((entry) => (
                  <EntryChip key={`${entry.kind}-${entry.id}`} entry={entry} onOpen={onOpenEntry} />
                ))}
                {list.length > CHIPS_PER_DAY && (
                  <Button variant="link" size="xs" className="h-auto justify-start p-0 text-[11px]" onClick={() => setDayYmd(day.ymd)}>
                    +{list.length - CHIPS_PER_DAY} more
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dayYmd !== null} onOpenChange={(open) => !open && setDayYmd(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dayYmd ? format(parseManilaDate(dayYmd), 'EEEE, MMMM d, yyyy') : ''}</DialogTitle>
            <DialogDescription>
              {dayEntries.length === 0 ? 'Nothing on this day.' : `${dayEntries.length} on the Calendar`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5" data-testid="day-sheet">
            {dayEntries.map((entry) => (
              <EntryChip
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                wide
                onOpen={(e) => {
                  setDayYmd(null);
                  onOpenEntry(e);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
