import { CalendarDays, ChartGantt, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { manilaTime } from '@/lib/manilaDate.js';
import { ENTRY_KINDS, LAYERS, kindOf } from './entryKinds.jsx';
import { formatEntryTime } from './entryFormat.js';
import { initials } from './entrySpan.js';

// Small parts both Calendar layouts share; each layout owns its own grid.

const LAYOUT_SWITCH = [
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'gantt', label: 'Gantt', icon: ChartGantt },
];

/** Calendar | Gantt. */
export function LayoutSwitch({ layout, onChange }) {
  return (
    <div className="flex rounded-xl bg-muted p-1" role="group" aria-label="Layout">
      {LAYOUT_SWITCH.map(({ key, label, icon: Icon }) => (
        <Button
          key={key}
          variant="ghost"
          aria-pressed={layout === key}
          onClick={() => onChange(key)}
          className={cn(
            'gap-2 rounded-lg px-3.5 font-semibold',
            layout === key ? 'bg-card text-foreground shadow-sm hover:bg-card' : 'text-muted-foreground',
          )}
        >
          <Icon size={16} />
          {label}
        </Button>
      ))}
    </div>
  );
}

const LAYER_DOT = { meetings: 'bg-teal-9', timeOff: 'bg-green-9', overtime: 'bg-violet-9' };

/** Layer toggles that double as the legend; each shows how many entries it holds in the loaded range. */
export function LayerToggles({ layers, toggleLayer, all }) {
  const counts = {};
  for (const e of all ?? []) {
    const layer = kindOf(e.kind)?.layer;
    if (layer) counts[layer] = (counts[layer] ?? 0) + 1;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Layers">
      {LAYERS.map(({ key, label }) => {
        const on = layers[key];
        return (
          <Button
            key={key}
            variant="ghost"
            aria-pressed={on}
            onClick={() => toggleLayer(key)}
            className={cn(
              'gap-2 rounded-full border border-border px-3 font-semibold',
              on ? 'bg-card text-foreground' : 'text-muted-foreground opacity-70',
            )}
          >
            {key === 'timeOff' && on ? (
              <span className="flex -space-x-0.5" aria-hidden>
                {['bg-green-9', 'bg-blue-9', 'bg-pink-9'].map((c) => (
                  <span key={c} className={cn('size-2 rounded-full ring-1 ring-card', c)} />
                ))}
              </span>
            ) : (
              <span className={cn('size-2 rounded-full', on ? LAYER_DOT[key] : 'bg-mauve-7')} aria-hidden />
            )}
            {label}
            <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-hidden>
              {counts[key] ?? 0}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/** The pending switch, for viewers who may see pending entries. */
export function PendingSwitch({ showPending, setShowPending }) {
  return (
    <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Switch checked={showPending} onCheckedChange={setShowPending} aria-label="Show pending" />
      Show pending
    </span>
  );
}

export function NavArrows({ onPrev, onNext, onToday, unit }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label={`Previous ${unit}`}>
        <ChevronLeft size={14} />
      </Button>
      <Button variant="outline" size="icon-sm" onClick={onNext} aria-label={`Next ${unit}`}>
        <ChevronRight size={14} />
      </Button>
      <Button variant="ghost" size="sm" onClick={onToday}>
        Today
      </Button>
    </div>
  );
}

/** Initials in a round chip. */
export function Face({ person, className }) {
  return (
    <span
      title={person?.name}
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-mauve-4 text-[10px] font-bold text-mauve-11 ring-2 ring-background',
        className,
      )}
    >
      {initials(person?.name)}
    </span>
  );
}

/** Coloured marker for an entry kind. */
export function KindDot({ kind, className }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', kindOf(kind)?.dot ?? 'bg-mauve-8', className)} />;
}

/** The colour key under each layout. */
export function KindKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Colour key">
      {Object.entries(ENTRY_KINDS).map(([kind, def]) => (
        <span key={kind} className="flex items-center gap-1.5">
          <KindDot kind={kind} />
          {def.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded border border-dashed border-mauve-9" />
        Pending
      </span>
    </div>
  );
}

const DAY_START = 8 * 60;
const DAY_END = 19 * 60;
const toMin = (iso) => {
  const [h, m] = manilaTime(iso).split(':');
  return Number(h) * 60 + Number(m);
};
const pct = (min) => `${((Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
const hh = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:00`;

/**
 * One Venue's day as a track from 8 AM to 7 PM. Meetings are blocks; when
 * `onPickSlot` is given, a click on free track asks for that hour.
 */
export function VenueStrip({ venue, meetings, ymd, onOpen, onPickSlot }) {
  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (e.clientX - rect.left) / rect.width : 0;
    const min = DAY_START + Math.floor((ratio * (DAY_END - DAY_START)) / 60) * 60;
    onPickSlot({ venueId: venue.id, date: ymd, start: hh(min), end: hh(Math.min(min + 60, 23 * 60)) });
  };
  return (
    <div className="relative min-w-0" data-testid={`venue-strip-${venue.name}`}>
      {onPickSlot ? (
        <Button
          variant="ghost"
          onClick={pick}
          aria-label={`Request ${venue.name} on ${ymd}`}
          className="block h-8 w-full rounded-md bg-mauve-3 p-0 hover:bg-mauve-4"
        />
      ) : (
        <div className="h-8 w-full rounded-md bg-mauve-3" />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-8 justify-between px-px">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="h-full w-px bg-mauve-5 first:opacity-0 last:opacity-0" />
        ))}
      </div>
      {meetings.map((m) => {
        const start = toMin(m.starts_at);
        const end = toMin(m.ends_at);
        const pending = m.status === 'PENDING';
        return (
          <Button
            key={m.id}
            variant="ghost"
            onClick={() => onOpen(m)}
            title={`${m.title} · ${formatEntryTime(m)}${pending ? ' (pending)' : ''}`}
            aria-label={`${m.title}, ${formatEntryTime(m)}`}
            className={cn(
              'absolute top-0 h-8 rounded-md p-0',
              pending ? 'border border-dashed border-teal-8 bg-teal-3 hover:bg-teal-4' : 'bg-teal-9 hover:bg-teal-10',
            )}
            style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
          />
        );
      })}
    </div>
  );
}
