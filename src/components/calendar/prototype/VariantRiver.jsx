/**
 * PROTOTYPE — Calendar redesign, variant F "Time river" (experimental). Throwaway.
 *
 * The week turned on its side: each day is a horizontal river from 7 AM to
 * 10 PM, with meetings and overtime floating in it at their real times. Who is
 * out sits on the bank (the left edge). You see the shape of every day at once:
 * crowded mornings, late overtime, a free afternoon. Today shows a "now" line.
 */
import { addDays, format, getDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { manilaDate, manilaTime, manilaToday, parseManilaDate, weekGrid } from '@/lib/manilaDate.js';
import { kindOf } from '../entryKinds.jsx';
import { formatEntryTime } from '../entryFormat.js';
import { placeDay } from '../timeGrid.js';
import { TIME_OFF, shortName, useProtoData } from './protoData.js';
import { Face, LayerToggles, NavArrows, PendingSwitch } from './protoParts.jsx';

const START = 7 * 60;
const END = 22 * 60;
const LANE = 26;
const at = (min) => `${((Math.min(Math.max(min, START), END) - START) / (END - START)) * 100}%`;
const HOURS = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START / 60 + i);
const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

const BLOCK = {
  MEETING: 'bg-teal-9 text-teal-1 hover:bg-teal-10',
  OVERTIME: 'bg-violet-9 text-violet-1 hover:bg-violet-10',
  UNDERTIME: 'bg-amber-9 text-amber-12 hover:bg-amber-10',
};

function DayRiver({ ymd, entries, today, nowMin, onOpen, onPickSlot }) {
  const date = parseManilaDate(ymd);
  const day = entries.filter((e) => e.manila_date === ymd);
  const out = day.filter((e) => TIME_OFF.has(e.kind));
  const { timed } = placeDay(day.filter((e) => !TIME_OFF.has(e.kind)), ymd);
  const lanes = Math.max(1, ...timed.map((b) => b.lane + 1));
  // Lanes from placeDay are per overlap cluster; stack them as rows here so every block keeps full height.
  const height = Math.max(lanes, 1) * LANE + 12;

  const pick = (e) => {
    if (!onPickSlot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = START + Math.floor(((e.clientX - rect.left) / rect.width) * (END - START) / 60) * 60;
    const hh = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:00`;
    onPickSlot({ date: ymd, start: hh(min), end: hh(Math.min(min + 60, 23 * 60)) });
  };

  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] border-b border-mauve-5 last:border-b-0" data-testid={`river-${ymd}`}>
      <div className="flex flex-col gap-1.5 border-r border-mauve-5 px-3 py-3">
        <span className="flex items-baseline gap-2">
          <span className={cn('text-xl font-black tabular-nums leading-none', ymd === today && 'underline decoration-2 underline-offset-4')}>
            {format(date, 'd')}
          </span>
          <span className="text-sm font-semibold text-muted-foreground">{format(date, 'EEEE')}</span>
        </span>
        {out.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {out.map((e) => (
              <Button
                key={`${e.kind}-${e.id}`}
                variant="ghost"
                onClick={() => onOpen(e)}
                aria-label={`${e.employee?.name}, ${kindOf(e.kind).label}`}
                title={`${e.employee?.name} · ${kindOf(e.kind).label}`}
                className="h-auto gap-1 rounded-full p-0 pr-1.5 text-[11px] font-semibold"
              >
                <Face person={e.employee} className="size-5 text-[8px] ring-0" />
                {shortName(e.employee?.name)}
              </Button>
            ))}
          </span>
        ) : (
          <span className="text-[11px] text-mauve-9">Everyone in</span>
        )}
      </div>
      <div className="relative overflow-hidden" style={{ minHeight: height }}>
        <Button variant="ghost" onClick={pick} aria-label={`Request a room on ${ymd}`} className="absolute inset-0 h-full rounded-none p-0 hover:bg-mauve-2" />
        {HOURS.map((h) => (
          <span
            key={h}
            className={cn('pointer-events-none absolute inset-y-0 w-px', h === 12 || h === 17 ? 'bg-mauve-6' : 'bg-mauve-4')}
            style={{ left: at(h * 60) }}
          />
        ))}
        <span className="pointer-events-none absolute inset-y-0 bg-mauve-3/70" style={{ left: at(17 * 60), right: 0 }} />
        {timed.map(({ entry: e, startMin, endMin, lane }) => (
          <Button
            key={`${e.kind}-${e.id}`}
            variant="ghost"
            onClick={() => onOpen(e)}
            title={`${e.title || kindOf(e.kind).label} · ${e.employee?.name} · ${formatEntryTime(e)}`}
            className={cn(
              'absolute h-[22px] min-w-0 justify-start overflow-hidden rounded-md px-1.5 text-[11px] font-semibold',
              BLOCK[e.kind] ?? 'bg-mauve-9 text-mauve-1',
              e.status === 'PENDING' && 'border border-dashed border-current bg-transparent text-foreground opacity-80',
            )}
            style={{ left: at(startMin), width: `calc(${at(endMin)} - ${at(startMin)} - 2px)`, top: 6 + lane * LANE }}
          >
            <span className="truncate">{e.kind === 'MEETING' ? `${e.title} · ${e.venue}` : `${shortName(e.employee?.name)} ${kindOf(e.kind).label}`}</span>
          </Button>
        ))}
        {ymd === today && nowMin >= START && nowMin <= END && (
          <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-mauve-12" style={{ left: at(nowMin) }}>
            <span className="absolute -top-0.5 -left-[3px] size-2 rounded-full bg-mauve-12" />
          </span>
        )}
      </div>
    </div>
  );
}

export default function VariantRiver({ anchor, go, layers, toggleLayer, showPending, setShowPending, sample, onPickSlot, onOpen }) {
  const week = weekGrid(anchor).map(manilaDate);
  const { entries, all, canSeePending, isLoading, error, refetch } = useProtoData({ from: week[0], to: week[6], layers, showPending, sample });
  const today = manilaToday();
  const [h, m] = manilaTime(new Date()).split(':').map(Number);
  const nowMin = h * 60 + m;
  const shown = week.filter((ymd) => ![0, 6].includes(getDay(parseManilaDate(ymd))) || entries.some((e) => e.manila_date === ymd));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="text-2xl font-black tracking-tight">Week of {format(parseManilaDate(week[0]), 'MMMM d')}</h2>
        <NavArrows
          unit="week"
          onPrev={() => go(manilaDate(addDays(parseManilaDate(anchor), -7)))}
          onNext={() => go(manilaDate(addDays(parseManilaDate(anchor), 7)))}
          onToday={() => go(today)}
        />
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
          <PendingSwitch canSeePending={canSeePending} showPending={showPending} setShowPending={setShowPending} />
        </div>
      </div>
      {error ? (
        <QueryError onRetry={refetch} />
      ) : isLoading ? (
        <PageLoading />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-mauve-5 bg-background">
          <div className="min-w-[56rem]">
            <div className="grid grid-cols-[11rem_minmax(0,1fr)] border-b border-mauve-5 bg-mauve-2">
              <span className="px-3 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground">Day · who is out</span>
              <div className="relative h-8 overflow-hidden">
                {HOURS.slice(1, -1).map((hr) => (
                  <span key={hr} className="absolute top-2 -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: at(hr * 60) }}>
                    {hourLabel(hr)}
                  </span>
                ))}
              </div>
            </div>
            {shown.map((ymd) => (
              <DayRiver key={ymd} ymd={ymd} entries={entries} today={today} nowMin={nowMin} onOpen={onOpen} onPickSlot={onPickSlot} />
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">The shaded part of each day is after 5 PM. Click an empty spot to request a room at that hour.</p>
    </div>
  );
}
