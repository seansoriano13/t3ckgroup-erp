import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { parseManilaDate, weekGrid, manilaDate } from '@/lib/manilaDate.js';
import { kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { placeDay } from './timeGrid.js';

const HOUR_PX = 40;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h) {
  return format(new Date(2000, 0, 1, h), 'h a');
}

function Chip({ entry, onOpen, showTime = false }) {
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
        {showTime && !entry.all_day ? ` · ${formatEntryTime(entry)}` : ''}
        {pending ? ' (pending)' : ''}
      </span>
    </Button>
  );
}

function TimedBlock({ block, onOpen }) {
  const { entry, startMin, endMin, lane, lanes } = block;
  const def = kindOf(entry.kind);
  const pending = entry.status === 'PENDING';
  return (
    <Button
      variant="outline"
      onClick={() => onOpen(entry)}
      title={`${entry.employee?.name} · ${def.label} · ${formatEntryTime(entry)}`}
      className={`absolute h-auto flex-col items-start justify-start gap-0 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] font-medium leading-tight ${def.chip} ${pending ? 'border-dashed opacity-80' : ''}`}
      style={{
        top: (startMin / 60) * HOUR_PX,
        height: Math.max(((endMin - startMin) / 60) * HOUR_PX, 14),
        left: `${(lane / lanes) * 100}%`,
        width: `${100 / lanes}%`,
      }}
    >
      <span className="block truncate">{entry.employee?.name}</span>
      <span className="block truncate">{def.label}</span>
    </Button>
  );
}

/** Time grid for one or seven days: all-day row on top, timed entries placed by Manila time. */
function TimeGrid({ days, entries, onOpenEntry, todayYmd }) {
  const placed = days.map((ymd) => ({ ymd, ...placeDay(entries, ymd) }));
  const cols = `3rem repeat(${days.length}, minmax(0, 1fr))`;
  return (
    <div className="hidden min-w-0 overflow-hidden rounded-lg border border-border sm:block" data-testid="time-grid">
      <div className="grid border-b border-border bg-muted/40 text-center text-[11px] font-semibold" style={{ gridTemplateColumns: cols }}>
        <div />
        {placed.map(({ ymd }) => (
          <div key={ymd} className={`py-1 ${ymd === todayYmd ? 'text-primary' : 'text-muted-foreground'}`}>
            {format(parseManilaDate(ymd), 'EEE d')}
          </div>
        ))}
      </div>
      <div className="grid border-b border-border" style={{ gridTemplateColumns: cols }} data-testid="all-day-row">
        <div className="p-1 text-[10px] text-muted-foreground">All day</div>
        {placed.map(({ ymd, allDay }) => (
          <div key={ymd} className="flex min-w-0 flex-col gap-0.5 border-l border-border p-1">
            {allDay.map((entry) => (
              <Chip key={`${entry.kind}-${entry.id}`} entry={entry} onOpen={onOpenEntry} />
            ))}
          </div>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-1 text-right text-[10px] text-muted-foreground">
                {h === 0 ? '' : hourLabel(h)}
              </div>
            ))}
          </div>
          {placed.map(({ ymd, timed }) => (
            <div key={ymd} data-testid={`col-${ymd}`} className="relative border-l border-border" style={{ height: HOUR_PX * 24 }}>
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_PX }} className="border-t border-border/60" />
              ))}
              {timed.map((block) => (
                <TimedBlock key={`${block.entry.kind}-${block.entry.id}`} block={block} onOpen={onOpenEntry} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Phone layout: entries listed under each day, no horizontal scroll. */
function Agenda({ days, entries, onOpenEntry, todayYmd }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:hidden" data-testid="calendar-agenda">
      {days.map((ymd) => {
        const { allDay, timed } = placeDay(entries, ymd);
        const rows = [...allDay, ...[...timed].sort((a, b) => a.startMin - b.startMin).map((b) => b.entry)];
        return (
          <section key={ymd} data-testid={`agenda-${ymd}`}>
            <h3 className={`mb-1 text-xs font-semibold ${ymd === todayYmd ? 'text-primary' : 'text-muted-foreground'}`}>
              {format(parseManilaDate(ymd), 'EEEE, MMM d')}
            </h3>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing on this day.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {rows.map((entry) => (
                  <Chip key={`${entry.kind}-${entry.id}`} entry={entry} onOpen={onOpenEntry} showTime />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function View({ days, ...props }) {
  return (
    <>
      <TimeGrid days={days} {...props} />
      <Agenda days={days} {...props} />
    </>
  );
}

export function CalendarWeek({ anchor, ...props }) {
  return <View days={weekGrid(anchor).map(manilaDate)} {...props} />;
}

const SLOT_MINUTES = 30;
const SLOTS = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => i * SLOT_MINUTES);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Day view with one column per active Venue for meetings; Time Off and overtime stay listed above. */
function VenueDay({ day, venues, entries, onOpenEntry, onPickSlot, todayYmd }) {
  const meetings = entries.filter((e) => e.kind === 'MEETING');
  const others = entries.filter((e) => e.kind !== 'MEETING');
  const above = placeDay(others, day);
  const aboveRows = [...above.allDay, ...[...above.timed].sort((a, b) => a.startMin - b.startMin).map((b) => b.entry)];
  const cols = `3rem repeat(${venues.length}, minmax(0, 1fr))`;
  return (
    <div className="min-w-0" data-testid="venue-day">
      <div className="mb-2 flex flex-col gap-1" data-testid="day-time-off">
        <h3 className={`text-xs font-semibold ${day === todayYmd ? 'text-primary' : 'text-muted-foreground'}`}>
          {format(parseManilaDate(day), 'EEEE, MMM d')}
        </h3>
        {aboveRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Time Off or overtime on this day.</p>
        ) : (
          aboveRows.map((entry) => <Chip key={`${entry.kind}-${entry.id}`} entry={entry} onOpen={onOpenEntry} showTime />)
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid border-b border-border bg-muted/40 text-center text-[11px] font-semibold" style={{ gridTemplateColumns: cols }}>
          <div />
          {venues.map((v) => (
            <div key={v.id} className="truncate px-1 py-1 text-muted-foreground">
              {v.name}
            </div>
          ))}
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            <div>
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_PX }} className="pr-1 text-right text-[10px] text-muted-foreground">
                  {h === 0 ? '' : hourLabel(h)}
                </div>
              ))}
            </div>
            {venues.map((v) => {
              const { timed } = placeDay(meetings.filter((m) => m.venue === v.name), day);
              return (
                <div key={v.id} data-testid={`venue-col-${v.name}`} className="relative border-l border-border" style={{ height: HOUR_PX * 24 }}>
                  {SLOTS.map((min) => (
                    <Button
                      key={min}
                      variant="ghost"
                      aria-label={`Request ${v.name} at ${hhmm(min)}`}
                      onClick={() => onPickSlot?.({ venueId: v.id, date: day, start: hhmm(min), end: hhmm(Math.min(min + 60, 23 * 60 + 45)) })}
                      className="block h-auto w-full rounded-none border-t border-border/60 p-0 hover:bg-muted focus-visible:bg-muted"
                      style={{ height: (SLOT_MINUTES / 60) * HOUR_PX }}
                    />
                  ))}
                  {timed.map((block) => (
                    <TimedBlock key={block.entry.id} block={block} onOpen={onOpenEntry} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The single-day view: one column per active Venue when Venues are given, else a plain day. */
export function CalendarDay({ anchor, venues, onPickSlot, ...props }) {
  if (venues?.length) {
    return (
      <>
        <div className="hidden sm:block">
          <VenueDay day={anchor} venues={venues} onPickSlot={onPickSlot} {...props} />
        </div>
        <Agenda days={[anchor]} {...props} />
      </>
    );
  }
  return <View days={[anchor]} {...props} />;
}
