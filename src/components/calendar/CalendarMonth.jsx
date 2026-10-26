import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { addDays, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { manilaDate, parseManilaDate } from '@/lib/manilaDate.js';
import { kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { monthWeeks } from './monthWeeks.js';
import { entriesToBars } from './peopleRows.js';
import { TIME_OFF_KINDS, shortName, time12 } from './entrySpan.js';
import { KindDot } from './calendarParts.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Weekends are narrower (the office works Monday to Friday), except on a phone, where every day needs the room.
const COLS = 'grid-cols-7 sm:grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,0.55fr))]';
const MAX_LANES = 3;
const MAX_LINES = 3;
const LANE = '1.5rem';

const isBar = (e) => TIME_OFF_KINDS.has(e.kind);
const lineText = (e) =>
  e.kind === 'MEETING' ? e.title : `${shortName(e.employee?.name)} ${e.kind === 'UNDERTIME' ? 'undertime' : 'overtime'}`;

function Week({ week, entries, selectedYmd, todayYmd, onSelectDay, onOpenEntry }) {
  const ymds = week.map((d) => d.ymd);
  const bars = entriesToBars(entries.filter(isBar), ymds);
  const shownBars = bars.filter((b) => b.lane < MAX_LANES);
  const lanes = Math.min(MAX_LANES, bars.reduce((n, b) => Math.max(n, b.lane + 1), 0));
  const hiddenBars = new Map();
  for (const b of bars.filter((x) => x.lane >= MAX_LANES)) {
    for (let i = ymds.indexOf(b.startYmd); i <= ymds.indexOf(b.endYmd); i++) hiddenBars.set(ymds[i], (hiddenBars.get(ymds[i]) ?? 0) + 1);
  }
  const lines = new Map(ymds.map((y) => [y, []]));
  for (const e of entries) if (!isBar(e) && lines.has(e.manila_date)) lines.get(e.manila_date).push(e);
  for (const list of lines.values()) list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));

  return (
    <div
      className={cn('grid border-b border-mauve-5 last:border-b-0', COLS)}
      style={{ gridTemplateRows: `2.25rem ${lanes ? `repeat(${lanes}, ${LANE})` : ''} minmax(4.5rem, auto)` }}
    >
      {week.map((day, i) => {
        const selected = day.ymd === selectedYmd;
        const count = entries.filter((e) => e.manila_date === day.ymd).length;
        return (
          <Button
            key={day.ymd}
            variant="ghost"
            data-day={day.ymd}
            data-testid={`day-${day.ymd}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelectDay?.(day.ymd)}
            aria-label={`${format(day.date, 'EEEE, MMMM d')}, ${count} on the Calendar`}
            aria-pressed={selected}
            className={cn(
              'h-auto min-w-0 items-start justify-start rounded-none border-l border-mauve-5 p-1 first:border-l-0 sm:p-2 hover:bg-mauve-3 focus-visible:z-20',
              (i > 4 || !day.inMonth) && 'bg-mauve-2',
              !day.inMonth && 'text-mauve-9',
              selected && 'bg-mauve-3 shadow-[inset_0_0_0_2px_var(--color-mauve-9)]',
            )}
            style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
          >
            <span
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full text-sm font-bold tabular-nums sm:size-7',
                day.ymd === todayYmd ? 'bg-mauve-12 text-mauve-1' : day.inMonth ? 'text-foreground' : 'text-mauve-9',
              )}
            >
              {format(day.date, 'd')}
            </span>
          </Button>
        );
      })}

      {shownBars.map((bar) => {
        const def = kindOf(bar.kind);
        const start = ymds.indexOf(bar.startYmd);
        const end = ymds.indexOf(bar.endYmd);
        const name = end > start ? bar.entry.employee?.name : shortName(bar.entry.employee?.name);
        return (
          <Button
            key={bar.key}
            variant="ghost"
            tabIndex={-1}
            onClick={() => onOpenEntry(bar.entry)}
            title={`${bar.entry.employee?.name} · ${def.label}${bar.pending ? ' (pending)' : ''}`}
            className={cn(
              'z-10 mx-1.5 hidden h-5 min-w-0 justify-start gap-1 rounded-md border px-2 text-xs font-semibold sm:flex',
              def.chip,
              bar.pending && 'border-dashed',
            )}
            style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: bar.lane + 2 }}
          >
            <span className="truncate">
              {name} · {def.label}
              {bar.pending && ' · pending'}
            </span>
          </Button>
        );
      })}

      {week.map((day, i) => {
        const list = lines.get(day.ymd);
        const extra = Math.max(0, list.length - MAX_LINES) + (hiddenBars.get(day.ymd) ?? 0);
        const dots = entries.filter((e) => e.manila_date === day.ymd);
        return (
          <div
            key={day.ymd}
            className="pointer-events-none z-10 flex min-w-0 flex-col gap-0.5 px-1 pb-2 sm:px-1.5"
            style={{ gridColumn: i + 1, gridRow: lanes + 2 }}
          >
            <div className="hidden flex-col gap-0.5 sm:flex">
              {list.slice(0, MAX_LINES).map((e) => (
                <Button
                  key={`${e.kind}-${e.id}`}
                  variant="ghost"
                  tabIndex={-1}
                  onClick={() => onOpenEntry(e)}
                  title={`${e.title || kindOf(e.kind).label} · ${e.employee?.name} · ${formatEntryTime(e)}`}
                  className={cn(
                    'pointer-events-auto h-5 min-w-0 justify-start gap-1.5 rounded-md px-1 text-xs font-medium',
                    e.status === 'PENDING' && 'italic text-muted-foreground',
                  )}
                >
                  <KindDot kind={e.kind} />
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{time12(e.starts_at)}</span>
                  <span className="truncate">{lineText(e)}</span>
                </Button>
              ))}
              {extra > 0 && (
                <Button
                  variant="link"
                  tabIndex={-1}
                  onClick={() => onSelectDay?.(day.ymd)}
                  className="pointer-events-auto h-5 justify-start px-1 text-xs font-semibold text-muted-foreground"
                >
                  +{extra} more
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 sm:hidden">
              {dots.slice(0, 6).map((e) => (
                <KindDot key={`${e.kind}-${e.id}`} kind={e.kind} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const EASE = [0.16, 1, 0.3, 1];
const SLIDE = {
  enter: (dir) => ({ x: dir * 56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir * -56, opacity: 0 }),
};

/**
 * The month grid (ADR 0039: Monday-first Manila weeks). Multi-day Time Off is
 * one bar across the days it covers; timed entries (meetings, overtime,
 * undertime) are one line each with their start time. On a phone a day shows
 * coloured dots instead. Changing month slides the grid; the arrow keys move
 * the selected day (← → a day, ↑ ↓ a week) once a day has focus.
 *
 *   selectedYmd  the highlighted day (the Calendar's day rail shows it)
 *   onSelectDay  called with a Manila date when a day is clicked or keyed to
 */
export default function CalendarMonth({ anchor, entries, onOpenEntry, todayYmd, selectedYmd = null, onSelectDay = null, loading = null }) {
  const weeks = monthWeeks(anchor);
  const month = anchor.slice(0, 7);
  const reduce = useReducedMotion();
  const grid = useRef(null);
  const keyed = useRef(false);
  const lastMonth = useRef(month);

  // Which way the month moved, kept until the next move so the exiting month slides the same way.
  const [moved, setMoved] = useState({ month, dir: 1 });
  if (moved.month !== month) setMoved({ month, dir: month > moved.month ? 1 : -1 });
  const dir = moved.month === month ? moved.dir : month > moved.month ? 1 : -1;

  const dayEl = () => (selectedYmd ? grid.current?.querySelector(`[data-day="${selectedYmd}"]`) : null);
  const settle = () => {
    dayEl()?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    if (keyed.current) {
      keyed.current = false;
      dayEl()?.focus({ preventScroll: true });
    }
  };

  // Inside one month nothing slides, so an arrow key's focus move happens here.
  useEffect(() => {
    const changed = lastMonth.current !== month;
    lastMonth.current = month;
    if (!changed && keyed.current) {
      keyed.current = false;
      dayEl()?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYmd]);

  const onKeyDown = (e) => {
    const by = STEP[e.key];
    if (!by || !onSelectDay || !e.target.dataset?.day) return;
    e.preventDefault();
    e.stopPropagation();
    keyed.current = true;
    onSelectDay(manilaDate(addDays(parseManilaDate(e.target.dataset.day), by)));
  };

  return (
    <div
      ref={grid}
      onKeyDown={onKeyDown}
      className="overflow-hidden rounded-2xl border border-mauve-5 bg-background"
      role="group"
      aria-label="Month"
      data-testid="calendar-month"
    >
      <div className={cn('grid border-b border-mauve-5 bg-mauve-2', COLS)}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="truncate px-1 py-2 text-center text-label font-bold uppercase tracking-wider text-muted-foreground sm:px-3 sm:text-left">
            {d}
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={month}
          custom={dir}
          variants={SLIDE}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reduce ? 0 : 0.26, ease: EASE }}
          onAnimationComplete={(def) => def === 'center' && settle()}
        >
          {loading ??
            weeks.map((week) => (
              <Week
                key={week[0].ymd}
                week={week}
                entries={entries}
                selectedYmd={selectedYmd}
                todayYmd={todayYmd}
                onSelectDay={onSelectDay}
                onOpenEntry={onOpenEntry}
              />
            ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
