/**
 * PROTOTYPE — Calendar redesign. Throwaway. Small parts the variants share;
 * each variant still owns its own layout.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import SlideOver, { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { MEETING_STATUS_LABEL } from '@/services/meetingRequestService';
import { manilaTime } from '@/lib/manilaDate.js';
import EntryDetail from '../EntryDetail.jsx';
import { LAYERS, kindOf } from '../entryKinds.jsx';
import { formatEntryDate, formatEntryTime } from '../entryFormat.js';
import { initials } from './protoData.js';

const LAYER_DOT = { meetings: 'bg-teal-9', timeOff: 'bg-green-9', overtime: 'bg-violet-9' };

/** Layer toggles that double as the legend; each shows how many entries it holds. */
export function LayerToggles({ layers, toggleLayer, all, stacked = false }) {
  const counts = {};
  for (const e of all) {
    const layer = kindOf(e.kind)?.layer;
    if (layer) counts[layer] = (counts[layer] ?? 0) + 1;
  }
  return (
    <div className={cn('flex gap-1.5', stacked ? 'flex-col' : 'flex-wrap items-center')} role="group" aria-label="Layers">
      {LAYERS.map(({ key, label }) => {
        const on = layers[key];
        return (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            aria-pressed={on}
            onClick={() => toggleLayer(key)}
            className={cn(
              'gap-2 rounded-full border border-border px-3 font-semibold',
              stacked && 'justify-start rounded-lg',
              on ? 'bg-card text-foreground' : 'text-muted-foreground opacity-70',
            )}
          >
            {key === 'timeOff' && on ? (
              <span className="flex -space-x-0.5">
                {['bg-green-9', 'bg-blue-9', 'bg-pink-9'].map((c) => (
                  <span key={c} className={cn('size-2 rounded-full ring-1 ring-card', c)} />
                ))}
              </span>
            ) : (
              <span className={cn('size-2 rounded-full', on ? LAYER_DOT[key] : 'bg-mauve-7')} />
            )}
            {label}
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{counts[key] ?? 0}</span>
          </Button>
        );
      })}
    </div>
  );
}

export function PendingSwitch({ canSeePending, showPending, setShowPending }) {
  if (!canSeePending) return null;
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Switch size="sm" checked={showPending} onCheckedChange={setShowPending} aria-label="Show pending" />
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
  return <span className={cn('size-2 shrink-0 rounded-full', kindOf(kind)?.dot ?? 'bg-mauve-8', className)} />;
}

const DAY_START = 8 * 60;
const DAY_END = 19 * 60;
const toMin = (iso) => {
  const [h, m] = manilaTime(iso).split(':');
  return Number(h) * 60 + Number(m);
};
const pct = (min) => `${(Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) / ((DAY_END - DAY_START) / 100)}%`;

/**
 * One Venue's day as a track from 8 AM to 7 PM. Meetings are blocks; a click on
 * free track asks for that hour. `compact` drops the hour ticks.
 */
export function VenueStrip({ venue, meetings, ymd, onOpen, onPickSlot, compact = false }) {
  const pick = (e) => {
    if (!onPickSlot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = DAY_START + Math.floor(((e.clientX - rect.left) / rect.width) * (DAY_END - DAY_START) / 60) * 60;
    const hh = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:00`;
    onPickSlot({ venueId: venue.id, date: ymd, start: hh(min), end: hh(Math.min(min + 60, 23 * 60)) });
  };
  return (
    <div className="relative min-w-0">
      <Button
        variant="ghost"
        onClick={pick}
        aria-label={`Request ${venue.name} on ${ymd}`}
        className={cn('block w-full rounded-md bg-mauve-3 p-0 hover:bg-mauve-4', compact ? 'h-2.5' : 'h-6')}
      />
      {!compact && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-6 justify-between px-px">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="h-full w-px bg-mauve-5 first:opacity-0 last:opacity-0" />
          ))}
        </div>
      )}
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
              'absolute top-0 rounded-md p-0 hover:brightness-95',
              compact ? 'h-2.5' : 'h-6',
              pending ? 'border border-dashed border-teal-8 bg-teal-3' : 'bg-teal-9 hover:bg-teal-10',
            )}
            style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
          />
        );
      })}
    </div>
  );
}

function SampleBody({ entry }) {
  const d = entry.details ?? {};
  const person = entry.employee ?? {};
  const meeting = entry.kind === 'MEETING';
  return (
    <SlideOverBody>
      <DetailSection title={meeting ? 'Requested by' : 'Who'}>
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department }} />
      </DetailSection>
      <DetailSection title="Details" aside={<span className="text-[11px] text-muted-foreground">Sample data</span>}>
        <dl>
          {meeting && <DetailRow label="Purpose">{d.purpose}</DetailRow>}
          {meeting && <DetailRow label="Venue">{entry.venue}</DetailRow>}
          <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>
          <DetailRow label="Status">{meeting ? MEETING_STATUS_LABEL[d.stage] : entry.status === 'PENDING' ? 'Pending' : 'Approved'}</DetailRow>
          {entry.hours != null && <DetailRow label="Hours">{entry.hours}</DetailRow>}
          {meeting && <DetailRow label="Participants">{(d.participants ?? []).map((p) => p.name).join(', ') || 'None'}</DetailRow>}
          {!meeting && d.reason && <DetailRow label="Reason">{d.reason}</DetailRow>}
        </dl>
      </DetailSection>
    </SlideOverBody>
  );
}

/** The real detail panel for real entries; a read-only stand-in for sample ones. */
export function ProtoDetail({ entry, onClose, entries, viewerId, onWithdraw }) {
  if (entry && !entry.sample) {
    return <EntryDetail entry={entry} onClose={onClose} entries={entries} viewerId={viewerId} onWithdraw={onWithdraw} />;
  }
  return (
    <SlideOver
      record={entry}
      icon={entry ? kindOf(entry.kind)?.icon : undefined}
      crumb="Calendar"
      identity={(e) => ({ ref: kindOf(e.kind)?.label, title: e.title || kindOf(e.kind)?.label, subtitle: e.employee?.name })}
      onClose={onClose}
    >
      {(e) => <SampleBody entry={e} />}
    </SlideOver>
  );
}
