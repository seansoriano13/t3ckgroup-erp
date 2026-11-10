import { useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { groupByDepartment, outByDay } from './peopleRows.js';
import { TIME_OFF_KINDS, time12 } from './entrySpan.js';
import { Face } from './calendarParts.jsx';

const NAME_W = '13rem';
// Day and weekend column widths, by how many weeks the chart shows.
const WIDTHS = { 2: { day: '4.25rem', weekend: '2.5rem' }, 4: { day: '3.5rem', weekend: '2rem' } };

/** A row: the pinned name cell, then the day grid. Every row shares `cols`, so columns line up exactly. */
function Row({ name, cols, children, gridClassName, gridStyle, testId }) {
  return (
    <div className="group flex border-b border-mauve-5" data-testid={testId}>
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-3 border-r border-mauve-5 bg-background px-4 group-hover:bg-mauve-2"
        style={{ width: NAME_W }}
      >
        {name}
      </div>
      <div className={cn('grid flex-1', gridClassName)} style={{ gridTemplateColumns: cols, ...gridStyle }}>
        {children}
      </div>
    </div>
  );
}

const dayTint = (d, todayYmd) => cn(d.weekend && 'bg-mauve-2', d.ymd === todayYmd && 'bg-mauve-3');

function DayHeader({ days, cols, todayYmd, out, compact }) {
  return (
    <div className="sticky top-0 z-20 flex border-b border-mauve-6 bg-mauve-2">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-end border-r border-mauve-5 bg-mauve-2 px-4 pb-3 text-label font-bold uppercase tracking-wider text-muted-foreground"
        style={{ width: NAME_W }}
      >
        People out each day
      </div>
      <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
        {days.map((d) => {
          const n = out.get(d.ymd) ?? 0;
          return (
            <div key={d.ymd} data-col={d.ymd} className={cn('flex scroll-ml-60 flex-col items-center gap-1 border-l border-mauve-5 py-2', dayTint(d, todayYmd))}>
              <span className="text-label font-bold uppercase tracking-wider text-muted-foreground">
                {format(d.date, compact || d.weekend ? 'EEEEE' : 'EEE')}
              </span>
              <span
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-full text-sm font-black tabular-nums',
                  d.ymd === todayYmd && 'bg-mauve-12 text-mauve-1',
                )}
              >
                {format(d.date, 'd')}
              </span>
              <span
                className={cn(
                  'h-6 rounded-full px-2 text-center text-xs leading-6 font-bold tabular-nums',
                  n === 0 ? 'text-mauve-8' : n >= 3 ? 'bg-amber-4 text-amber-12' : 'bg-mauve-4 text-mauve-12',
                )}
                title={`${n} out`}
                data-testid={`out-${d.ymd}`}
              >
                {n === 0 ? '·' : compact ? n : `${n} out`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupRow({ label, count, open, onToggle }) {
  return (
    <div className="flex border-b border-mauve-5 bg-mauve-2">
      <Button
        variant="ghost"
        onClick={onToggle}
        aria-expanded={open}
        className="sticky left-0 z-10 h-10 justify-start gap-2 rounded-none bg-mauve-2 px-4 text-label font-bold uppercase tracking-wider text-muted-foreground"
        style={{ width: NAME_W }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        <span className="ml-auto font-mono text-sm normal-case tracking-normal">{count}</span>
      </Button>
      <div className="flex-1" />
    </div>
  );
}

function VenueRow({ venue, days, cols, meetings, todayYmd, compact, onOpenEntry, onPickSlot }) {
  const shown = compact ? 2 : 3;
  return (
    <Row
      cols={cols}
      testId={`venue-row-${venue.name}`}
      name={
        <span className="flex min-w-0 flex-col py-2">
          <span className="truncate text-sm font-semibold">{venue.name}</span>
          <span className="text-xs text-muted-foreground">Meeting start times</span>
        </span>
      }
    >
      {days.map((d) => {
        const here = meetings
          .filter((m) => m.manila_date === d.ymd && m.venue === venue.name)
          .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
        return (
          <div key={d.ymd} className={cn('flex min-w-0 flex-col gap-1 border-l border-mauve-5 p-1.5', dayTint(d, todayYmd))}>
            {here.slice(0, shown).map((m) => (
              <Button
                key={m.id}
                variant="ghost"
                onClick={() => onOpenEntry(m)}
                title={`${m.title} · ${formatEntryTime(m)}`}
                aria-label={`${m.title}, ${formatEntryTime(m)}`}
                className={cn(
                  'h-6 justify-center rounded-md px-1 font-mono text-xs font-semibold tabular-nums',
                  m.status === 'PENDING' ? 'border border-dashed border-teal-7 text-teal-11' : 'bg-teal-3 text-teal-11 hover:bg-teal-4',
                )}
              >
                {time12(m.starts_at)}
              </Button>
            ))}
            {here.length > shown && <span className="text-center text-xs font-semibold text-muted-foreground">+{here.length - shown}</span>}
            {here.length === 0 && !d.weekend && onPickSlot && (
              <Button
                variant="ghost"
                onClick={() => onPickSlot({ venueId: venue.id, date: d.ymd })}
                aria-label={`Book ${venue.name} on ${format(d.date, 'MMMM d')}`}
                className="h-6 rounded-md px-1 text-xs font-medium text-mauve-9 hover:text-foreground"
              >
                {compact ? '+' : 'Free'}
              </Button>
            )}
          </div>
        );
      })}
    </Row>
  );
}

function PersonRow({ row, days, cols, todayYmd, onOpenEntry }) {
  const ymds = days.map((d) => d.ymd);
  return (
    <Row
      cols={cols}
      testId={`person-${row.employee.id}`}
      gridClassName="relative"
      gridStyle={{ gridTemplateRows: `repeat(${row.lanes}, 2.125rem)`, paddingBlock: 2 }}
      name={
        <>
          <Face person={row.employee} className="size-7 text-label" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{row.employee.name}</span>
            <span className="truncate text-xs text-muted-foreground">{row.summary}</span>
          </span>
        </>
      }
    >
      {days.map((d, i) => (
        <div key={d.ymd} className={cn('border-l border-mauve-5', dayTint(d, todayYmd))} style={{ gridColumn: i + 1, gridRow: '1 / -1' }} />
      ))}
      {row.bars.map((bar) => {
        const def = kindOf(bar.kind);
        const start = ymds.indexOf(bar.startYmd);
        const end = ymds.indexOf(bar.endYmd);
        const e = bar.entry;
        const span = end - start + 1;
        const timed = !TIME_OFF_KINDS.has(bar.kind);
        const label = timed ? `${bar.kind === 'OVERTIME' ? 'OT' : 'UT'} ${e.hours != null ? `${Number(e.hours)}h` : ''}` : def.label;
        return (
          <Button
            key={bar.key}
            variant="ghost"
            onClick={() => onOpenEntry(e)}
            data-testid="people-bar"
            data-pending={bar.pending}
            title={`${e.employee?.name} · ${def.label}${timed ? ` · ${formatEntryTime(e)}` : ''}${bar.pending ? ' (pending)' : ''}`}
            className={cn(
              'z-1 mx-1.5 my-1 h-auto min-w-0 justify-start gap-1 rounded-md border px-2.5 py-0 text-xs font-semibold',
              def.chip,
              bar.pending && 'border-dashed',
              timed && 'justify-center px-2',
            )}
            style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: bar.lane + 1 }}
          >
            <span className="truncate">
              {label}
              {span > 1 && <span className="font-medium opacity-75"> · {span} days</span>}
              {bar.pending && <span className="font-medium opacity-75"> · pending</span>}
            </span>
          </Button>
        );
      })}
    </Row>
  );
}

const EASE = [0.16, 1, 0.3, 1];

/**
 * The Gantt: two or four weeks across. Rows are what people plan around: each
 * room (meeting start times, free days to book), then each person grouped by
 * department, with every request a bar across the days it covers. The header
 * counts how many people are out each day. Weekends are narrower.
 *
 *   days         from ganttDays(): [{ date, ymd, weekend }]
 *   onPickSlot   when given, a free room day opens the request form
 */
export default function CalendarGantt({ days, entries, layers, venues, todayYmd, selectedYmd, onOpenEntry, onPickSlot = null }) {
  const compact = days.length > 14;
  const width = WIDTHS[days.length / 7] ?? WIDTHS[2];
  const cols = days.map((d) => `minmax(${d.weekend ? width.weekend : width.day}, ${d.weekend ? '0.55fr' : '1fr'})`).join(' ');
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState({});
  const reduce = useReducedMotion();
  const chart = useRef(null);
  const startYmd = days[0].ymd;

  // Which way the range moved, kept so the exiting range slides the same way.
  const [moved, setMoved] = useState({ from: startYmd, dir: 1 });
  if (moved.from !== startYmd) setMoved({ from: startYmd, dir: startYmd > moved.from ? 1 : -1 });
  const dir = moved.from === startYmd ? moved.dir : startYmd > moved.from ? 1 : -1;
  // Bring the selected day's column into view after the range moves.
  const settle = () =>
    chart.current
      ?.querySelector(`[data-col="${selectedYmd}"]`)
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });

  const meetings = entries.filter((e) => e.kind === 'MEETING');
  const out = outByDay(entries);
  const needle = query.trim();
  const groups = groupByDepartment(entries, days.map((d) => d.ymd), needle);
  const toggle = (key) => setClosed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div
      ref={chart}
      className="max-h-[calc(100vh-16rem)] min-h-96 min-w-0 overflow-auto rounded-2xl border border-mauve-6 bg-background"
      data-testid="calendar-gantt"
    >
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={`${startYmd}-${days.length}`}
          custom={dir}
          initial={{ x: reduce ? 0 : dir * 48, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: reduce ? 0 : dir * -48, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.26, ease: EASE }}
          onAnimationComplete={settle}
          className="w-max min-w-full"
        >
          <DayHeader days={days} cols={cols} todayYmd={todayYmd} out={out} compact={compact} />

          {layers.meetings && venues.length > 0 && (
            <>
              <GroupRow label="Rooms" count={meetings.length} open={!closed.__rooms} onToggle={() => toggle('__rooms')} />
              {!closed.__rooms &&
                venues.map((v) => (
                  <VenueRow
                    key={v.id}
                    venue={v}
                    days={days}
                    cols={cols}
                    meetings={meetings}
                    todayYmd={todayYmd}
                    compact={compact}
                    onOpenEntry={onOpenEntry}
                    onPickSlot={onPickSlot}
                  />
                ))}
            </>
          )}

          <div className="flex border-b border-mauve-5">
            <div className="sticky left-0 z-10 shrink-0 border-r border-mauve-5 bg-background p-2" style={{ width: NAME_W }}>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a person or department"
                aria-label="Find a person or department"
                icon={Search}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex-1" />
          </div>

          {groups.length === 0 && (
            <p className="sticky left-0 p-6 text-sm text-muted-foreground">
              {needle ? 'Nobody matches that search.' : 'Nobody is out or on overtime in this range.'}
            </p>
          )}
          {groups.map(([dept, rows]) => (
            <div key={dept}>
              <GroupRow label={dept} count={rows.length} open={!closed[dept]} onToggle={() => toggle(dept)} />
              {!closed[dept] &&
                rows.map((row) => <PersonRow key={row.employee.id} row={row} days={days} cols={cols} todayYmd={todayYmd} onOpenEntry={onOpenEntry} />)}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
