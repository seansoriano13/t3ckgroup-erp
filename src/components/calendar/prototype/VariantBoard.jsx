/**
 * PROTOTYPE — Calendar redesign, "Gantt" (was variant C, who & where board). Throwaway.
 *
 * A planning chart across two or four weeks: rows are the things people plan
 * around (each room, then each person, grouped by department), columns are
 * days, and every request is a bar across the days it covers. One glance
 * answers "who is out" and "which room is free". Weekends are narrower; the
 * header counts how many people are out each day.
 */
import { useMemo, useRef, useState } from "react";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { addDays, format } from "date-fns";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import {
  manilaDate,
  manilaTime,
  manilaToday,
  parseManilaDate,
  weekGrid,
} from "@/lib/manilaDate.js";
import { kindOf } from "../entryKinds.jsx";
import { formatEntryTime } from "../entryFormat.js";
import { entriesToBars } from "../peopleRows.js";
import { TIME_OFF, useProtoData, withSpan } from "./protoData.js";
import { Face, LayerToggles, NavArrows, PendingSwitch } from "./protoParts.jsx";
import { KindKey } from "./VariantMonthRail.jsx";

const NAME_W = "15rem";
const SPANS = [
  { days: 14, label: "2 weeks", day: "4.75rem", weekend: "2.75rem" },
  { days: 28, label: "4 weeks", day: "3.5rem", weekend: "2rem" },
];

const t12 = (iso) => {
  const [h, m] = manilaTime(iso).split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
};

/** A row: the pinned name cell, then the day grid. Every row shares `cols`, so columns line up exactly. */
function Row({ name, cols, className, children, gridClassName, gridStyle }) {
  return (
    <div className={cn("group flex border-b border-mauve-5", className)}>
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-3 border-r border-mauve-5 bg-background px-4 group-hover:bg-mauve-2"
        style={{ width: NAME_W }}
      >
        {name}
      </div>
      <div
        className={cn("grid flex-1", gridClassName)}
        style={{ gridTemplateColumns: cols, ...gridStyle }}
      >
        {children}
      </div>
    </div>
  );
}

const dayTint = (d, today) =>
  cn(d.weekend && "bg-mauve-2", d.ymd === today && "bg-mauve-3");

function DayHeader({ days, cols, today, outByDay, compact }) {
  return (
    <div className="sticky top-0 z-20 flex border-b border-mauve-6 bg-mauve-2">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-end border-r border-mauve-5 bg-mauve-2 px-4 pb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground"
        style={{ width: NAME_W }}
      >
        People out each day
      </div>
      <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
        {days.map((d) => {
          const out = outByDay.get(d.ymd) ?? 0;
          return (
            <div
              key={d.ymd}
              data-col={d.ymd}
              className={cn(
                "flex scroll-ml-60 flex-col items-center gap-1 border-l border-mauve-5 py-2.5",
                dayTint(d, today),
              )}
            >
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {format(d.date, compact || d.weekend ? "EEEEE" : "EEE")}
              </span>
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-full text-base font-black tabular-nums",
                  d.ymd === today && "bg-mauve-12 text-mauve-1",
                )}
              >
                {format(d.date, "d")}
              </span>
              <span
                className={cn(
                  "h-6 rounded-full px-2 text-center text-xs leading-6 font-bold tabular-nums",
                  out === 0
                    ? "text-mauve-8"
                    : out >= 3
                      ? "bg-amber-4 text-amber-12"
                      : "bg-mauve-4 text-mauve-12",
                )}
                title={`${out} out`}
              >
                {out === 0 ? "·" : compact ? out : `${out} out`}
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
        className="sticky left-0 z-10 h-10 justify-start gap-2 rounded-none bg-mauve-2 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground"
        style={{ width: NAME_W }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        <span className="ml-auto font-mono text-sm normal-case tracking-normal">
          {count}
        </span>
      </Button>
      <div className="flex-1" />
    </div>
  );
}

function VenueRow({
  venue,
  days,
  cols,
  meetings,
  today,
  compact,
  onOpen,
  onPickSlot,
}) {
  return (
    <Row
      cols={cols}
      name={
        <span className="flex min-w-0 flex-col py-2.5">
          <span className="truncate text-[15px] font-semibold">
            {venue.name}
          </span>
          <span className="text-[13px] text-muted-foreground">
            Meeting start times
          </span>
        </span>
      }
    >
      {days.map((d) => {
        const here = meetings
          .filter((m) => m.manila_date === d.ymd && m.venue === venue.name)
          .sort((a, b) =>
            String(a.starts_at).localeCompare(String(b.starts_at)),
          );
        const shown = compact ? 2 : 3;
        return (
          <div
            key={d.ymd}
            className={cn(
              "flex min-w-0 flex-col gap-1 border-l border-mauve-5 p-1.5",
              dayTint(d, today),
            )}
          >
            {here.slice(0, shown).map((m) => (
              <Button
                key={m.id}
                variant="ghost"
                onClick={() => onOpen(m)}
                title={`${m.title} · ${formatEntryTime(m)}`}
                aria-label={`${m.title}, ${formatEntryTime(m)}`}
                className={cn(
                  "h-6 justify-center rounded-md px-1 font-mono text-xs font-semibold tabular-nums",
                  m.status === "PENDING"
                    ? "border border-dashed border-teal-7 text-teal-11"
                    : "bg-teal-3 text-teal-11 hover:bg-teal-4",
                )}
              >
                {t12(m.starts_at)}
              </Button>
            ))}
            {here.length > shown && (
              <span className="text-center text-xs font-semibold text-muted-foreground">
                +{here.length - shown}
              </span>
            )}
            {here.length === 0 && !d.weekend && onPickSlot && (
              <Button
                variant="ghost"
                onClick={() => onPickSlot({ venueId: venue.id, date: d.ymd })}
                aria-label={`Book ${venue.name} on ${format(d.date, "MMMM d")}`}
                className="h-6 rounded-md px-1 text-[13px] font-medium text-mauve-9 hover:text-foreground"
              >
                {compact ? "+" : "Free"}
              </Button>
            )}
          </div>
        );
      })}
    </Row>
  );
}

function PersonRow({ row, days, cols, today, onOpen }) {
  const ymds = days.map((d) => d.ymd);
  const lanes = row.bars.reduce((n, b) => Math.max(n, b.lane + 1), 1);
  return (
    <Row
      cols={cols}
      gridClassName="relative"
      gridStyle={{
        gridTemplateRows: `repeat(${lanes}, 2.5rem)`,
        paddingBlock: 2,
      }}
      name={
        <>
          <Face person={row.employee} className="size-8 text-label" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold">
              {row.employee.name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {row.summary}
            </span>
          </span>
        </>
      }
    >
      {days.map((d, i) => (
        <div
          key={d.ymd}
          className={cn("border-l border-mauve-5", dayTint(d, today))}
          style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
        />
      ))}
      {row.bars.map((bar) => {
        const def = kindOf(bar.kind);
        const start = ymds.indexOf(bar.startYmd);
        const end = ymds.indexOf(bar.endYmd);
        const e = bar.entry;
        const span = end - start + 1;
        const timed = !TIME_OFF.has(bar.kind);
        const label = timed
          ? `${bar.kind === "OVERTIME" ? "OT" : "UT"} ${e.hours ?? ""}h`
          : def.label;
        return (
          <Button
            key={bar.key}
            variant="ghost"
            onClick={() => onOpen(e)}
            title={`${e.employee?.name} · ${def.label}${timed ? ` · ${formatEntryTime(e)}` : ""}${bar.pending ? " (pending)" : ""}`}
            className={cn(
              "z-1 mx-1.5 my-1 h-auto min-w-0 justify-start gap-1 rounded-md border px-2.5 py-0 text-[13px] font-semibold",
              def.chip,
              bar.pending && "border-dashed",
              timed && "justify-center px-2",
            )}
            style={{
              gridColumn: `${start + 1} / ${end + 2}`,
              gridRow: bar.lane + 1,
            }}
          >
            <span className="truncate">
              {label}
              {span > 1 && (
                <span className="font-medium opacity-75"> · {span} days</span>
              )}
              {bar.pending && (
                <span className="font-medium opacity-75"> · pending</span>
              )}
            </span>
          </Button>
        );
      })}
    </Row>
  );
}

const EASE = [0.16, 1, 0.3, 1];

export default function VariantBoard({
  anchor,
  go,
  layers,
  toggleLayer,
  showPending,
  setShowPending,
  sample,
  onPickSlot,
  onOpen,
  switcher,
}) {
  const [spanIndex, setSpanIndex] = useState(0);
  const span = SPANS[spanIndex];
  const compact = span.days > 14;
  const startYmd = manilaDate(weekGrid(anchor)[0]);
  const days = useMemo(
    () =>
      Array.from({ length: span.days }, (_, i) => {
        const date = addDays(parseManilaDate(startYmd), i);
        return { date, ymd: manilaDate(date), weekend: i % 7 > 4 };
      }),
    [startYmd, span.days],
  );
  const cols = days
    .map(
      (d) =>
        `minmax(${d.weekend ? span.weekend : span.day}, ${d.weekend ? "0.55fr" : "1fr"})`,
    )
    .join(" ");
  const from = days[0].ymd;
  const to = days[days.length - 1].ymd;
  const { entries, all, venues, canSeePending, isLoading, error, refetch } =
    useProtoData({ from, to, layers, showPending, sample });
  const today = manilaToday();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState({});
  const reduce = useReducedMotion();
  const chart = useRef(null);
  const open = (e) => onOpen(withSpan(e, entries));

  // Which way the range moved, kept so the exiting range slides the same way.
  const [moved, setMoved] = useState({ from: startYmd, dir: 1 });
  if (moved.from !== startYmd)
    setMoved({ from: startYmd, dir: startYmd > moved.from ? 1 : -1 });
  const dir =
    moved.from === startYmd ? moved.dir : startYmd > moved.from ? 1 : -1;
  // Bring the selected day's column into view after the range moves.
  const settle = () =>
    chart.current
      ?.querySelector(`[data-col="${anchor}"]`)
      ?.scrollIntoView({
        inline: "nearest",
        block: "nearest",
        behavior: reduce ? "auto" : "smooth",
      });

  const meetings = entries.filter((e) => e.kind === "MEETING");
  const outByDay = new Map();
  for (const e of entries)
    if (TIME_OFF.has(e.kind))
      outByDay.set(e.manila_date, (outByDay.get(e.manila_date) ?? 0) + 1);

  const ymds = days.map((d) => d.ymd);
  const people = new Map();
  for (const e of entries.filter((x) => x.kind !== "MEETING")) {
    const p = e.employee;
    if (!p?.id) continue;
    const row = people.get(p.id) ?? { employee: p, list: [] };
    row.list.push(e);
    people.set(p.id, row);
  }
  const needle = query.trim().toLowerCase();
  const departments = new Map();
  for (const { employee, list } of people.values()) {
    if (
      needle &&
      !`${employee.name} ${employee.department}`.toLowerCase().includes(needle)
    )
      continue;
    const dept = employee.department || "No department";
    const rows = departments.get(dept) ?? [];
    const out = new Set(
      list.filter((e) => TIME_OFF.has(e.kind)).map((e) => e.manila_date),
    ).size;
    const ot = list
      .filter((e) => e.kind === "OVERTIME")
      .reduce((h, e) => h + Number(e.hours ?? 0), 0);
    const summary =
      [
        out && `${out} ${out === 1 ? "day" : "days"} out`,
        ot && `${ot} h overtime`,
      ]
        .filter(Boolean)
        .join(" · ") || "Undertime";
    rows.push({ employee, bars: entriesToBars(list, ymds), summary });
    departments.set(dept, rows);
  }
  const groups = [...departments.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {switcher}
        <h2 className="text-3xl font-black tracking-tight">
          {format(days[0].date, "MMM d")}{" "}
          <span className="text-muted-foreground">to</span>{" "}
          {format(days[days.length - 1].date, "MMM d, yyyy")}
        </h2>
        <NavArrows
          unit="week"
          onPrev={() => go(manilaDate(addDays(parseManilaDate(anchor), -7)))}
          onNext={() => go(manilaDate(addDays(parseManilaDate(anchor), 7)))}
          onToday={() => go(today)}
        />
        <div
          className="flex rounded-xl bg-muted p-1"
          role="group"
          aria-label="Range"
        >
          {SPANS.map((s, i) => (
            <Button
              key={s.days}
              variant="ghost"
              size="sm"
              aria-pressed={i === spanIndex}
              onClick={() => setSpanIndex(i)}
              className={cn(
                "rounded-lg px-3 font-semibold",
                i === spanIndex
                  ? "bg-card text-foreground shadow-sm hover:bg-card"
                  : "text-muted-foreground",
              )}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
          <PendingSwitch
            canSeePending={canSeePending}
            showPending={showPending}
            setShowPending={setShowPending}
          />
        </div>
      </div>

      {error ? (
        <QueryError onRetry={refetch} />
      ) : isLoading ? (
        <PageLoading />
      ) : (
        <>
          <div
            ref={chart}
            className="max-h-[calc(100vh-16rem)] min-h-96 min-w-0 overflow-auto rounded-2xl border border-mauve-6 bg-background"
            data-testid="gantt"
          >
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={`${startYmd}-${span.days}`}
                custom={dir}
                initial={{ x: reduce ? 0 : dir * 48, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: reduce ? 0 : dir * -48, opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.26, ease: EASE }}
                onAnimationComplete={settle}
                className="w-max min-w-full"
              >
                <DayHeader
                  days={days}
                  cols={cols}
                  today={today}
                  outByDay={outByDay}
                  compact={compact}
                />

                {layers.meetings !== false && (
                  <>
                    <GroupRow
                      label="Rooms"
                      count={meetings.length}
                      open={!closed.__rooms}
                      onToggle={() =>
                        setClosed((c) => ({ ...c, __rooms: !c.__rooms }))
                      }
                    />
                    {!closed.__rooms &&
                      venues.map((v) => (
                        <VenueRow
                          key={v.id}
                          venue={v}
                          days={days}
                          cols={cols}
                          meetings={meetings}
                          today={today}
                          compact={compact}
                          onOpen={open}
                          onPickSlot={onPickSlot}
                        />
                      ))}
                  </>
                )}

                <div className="flex border-b border-mauve-5">
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r border-mauve-5 bg-background p-2"
                    style={{ width: NAME_W }}
                  >
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
                  <p className="sticky left-0 p-6 text-[15px] text-muted-foreground">
                    {needle
                      ? "Nobody matches that search."
                      : "Nobody is out or on overtime in this range."}
                  </p>
                )}
                {groups.map(([dept, rows]) => (
                  <div key={dept}>
                    <GroupRow
                      label={dept}
                      count={rows.length}
                      open={!closed[dept]}
                      onToggle={() =>
                        setClosed((c) => ({ ...c, [dept]: !c[dept] }))
                      }
                    />
                    {!closed[dept] &&
                      rows
                        .sort((a, b) =>
                          a.employee.name.localeCompare(b.employee.name),
                        )
                        .map((row) => (
                          <PersonRow
                            key={row.employee.id}
                            row={row}
                            days={days}
                            cols={cols}
                            today={today}
                            onOpen={open}
                          />
                        ))}
                  </div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
          <KindKey />
        </>
      )}
    </div>
  );
}
