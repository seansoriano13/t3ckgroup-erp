import { format } from 'date-fns';
import { CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { MEETING_STATUS_LABEL } from '@/services/meetingRequestService';
import { kindOf } from './entryKinds.jsx';
import { isOut, time12 } from './entrySpan.js';
import { Face, KindDot, VenueStrip } from './calendarParts.jsx';

// The hour marks under each room's strip (8 AM to 7 PM).
const STRIP_RULER = ['8a', '10a', '12p', '2p', '4p', '6p'];

function RailSection({ title, count, children }) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h3 className="flex items-baseline justify-between text-label font-bold uppercase tracking-wider text-muted-foreground">
        {title}
        <span className="font-mono text-sm tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

const byStart = (a, b) => String(a.starts_at).localeCompare(String(b.starts_at));

/**
 * The selected day beside the month: who is out, each room's day as a strip
 * (click a free spot to request it), and overtime. Sections follow the layer
 * toggles, so a filtered Calendar (no Meetings) shows no rooms.
 *
 *   onPickSlot  when given, "Book a room" and the strips open the request form
 */
export default function DayRail({ ymd, entries, layers, venues, todayYmd, onOpenEntry, onPickSlot = null }) {
  const date = parseManilaDate(ymd);
  const day = entries.filter((e) => e.manila_date === ymd);
  const out = day.filter(isOut);
  const meetings = day.filter((e) => e.kind === 'MEETING').sort(byStart);
  const overtime = day.filter((e) => e.kind === 'OVERTIME').sort(byStart);

  return (
    <aside className="flex flex-col gap-6 rounded-2xl border border-mauve-5 bg-card p-5 xl:sticky xl:top-4" data-testid="day-rail" aria-live="polite">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {format(date, 'EEEE')}
            {ymd === todayYmd && <span className="rounded-full bg-mauve-12 px-2.5 py-0.5 text-xs font-bold text-mauve-1">Today</span>}
          </p>
          <h2 className="text-xl font-black tracking-tight">{format(date, 'MMMM d')}</h2>
        </div>
        {onPickSlot && layers.meetings && (
          <Button variant="outline" onClick={() => onPickSlot({ date: ymd })}>
            <CalendarPlus size={16} />
            Book a room
          </Button>
        )}
      </header>

      {layers.timeOff && (
        <RailSection title="Out of office" count={out.length}>
          {out.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone is in.</p>
          ) : (
            <ul className="flex flex-col">
              {out.map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  <Button variant="ghost" onClick={() => onOpenEntry(e)} className="h-auto w-full justify-start gap-3 px-2 py-2">
                    <Face person={e.employee} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold">{e.employee?.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.employee?.department}</span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold',
                        kindOf(e.kind).chip,
                        e.status === 'PENDING' && 'border-dashed',
                      )}
                    >
                      {kindOf(e.kind).label}
                      {e.kind === 'UNDERTIME' && ` from ${time12(e.starts_at)}`}
                      {e.status === 'PENDING' && ' · pending'}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      )}

      {layers.meetings && (
        <RailSection title="Rooms" count={meetings.length}>
          {venues.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {meetings.length ? `${meetings.length} meetings, no rooms set up.` : 'No rooms set up.'}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {venues.map((v) => {
                const here = meetings.filter((m) => m.venue === v.name);
                return (
                  <div key={v.id} className="flex flex-col gap-2">
                    <span className="flex items-baseline justify-between text-sm font-semibold">
                      {v.name}
                      <span className="text-xs font-medium text-muted-foreground">{here.length ? `${here.length} booked` : 'Free all day'}</span>
                    </span>
                    <VenueStrip venue={v} meetings={here} ymd={ymd} onOpen={onOpenEntry} onPickSlot={onPickSlot} />
                    <div className="flex justify-between font-mono text-[11px] text-muted-foreground" aria-hidden>
                      {STRIP_RULER.map((r) => (
                        <span key={r}>{r}</span>
                      ))}
                    </div>
                    {here.map((m) => (
                      <Button key={m.id} variant="ghost" onClick={() => onOpenEntry(m)} className="h-auto justify-start gap-3 px-2 py-1.5 text-left">
                        <span className="w-28 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {time12(m.starts_at)}–{time12(m.ends_at)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-sm font-medium', m.status === 'PENDING' && 'italic text-muted-foreground')}>
                            {m.title}
                          </span>
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
          )}
        </RailSection>
      )}

      {layers.overtime && (
        <RailSection title="Overtime" count={overtime.length}>
          {overtime.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overtime filed.</p>
          ) : (
            overtime.map((e) => (
              <Button key={e.id} variant="ghost" onClick={() => onOpenEntry(e)} className="h-auto justify-start gap-3 px-2 py-1.5">
                <KindDot kind="OVERTIME" />
                <span className={cn('flex-1 truncate text-left text-sm font-medium', e.status === 'PENDING' && 'italic text-muted-foreground')}>
                  {e.employee?.name}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {time12(e.starts_at)}–{time12(e.ends_at)}
                </span>
              </Button>
            ))
          )}
        </RailSection>
      )}
    </aside>
  );
}
