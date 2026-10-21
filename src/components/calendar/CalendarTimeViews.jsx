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

/** The single-day view. A later ticket adds one column per Venue for meetings. */
export function CalendarDay({ anchor, ...props }) {
  return <View days={[anchor]} {...props} />;
}
