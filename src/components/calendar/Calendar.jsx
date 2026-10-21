import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { getPermissionContext } from '@/utils/permissions';
import { manilaToday } from '@/lib/manilaDate.js';
import CalendarMonth from '@/components/calendar/CalendarMonth';
import CalendarPeople from '@/components/calendar/CalendarPeople';
import { CalendarDay, CalendarWeek } from '@/components/calendar/CalendarTimeViews';
import EntryDetail from '@/components/calendar/EntryDetail';
import { LAYERS, visibleEntries } from '@/components/calendar/entryKinds.jsx';
import { VIEWS, parseCalendarParams, shiftDate, viewRange, viewTitle } from '@/components/calendar/calendarNav.js';
import { useCalendarLayers } from '@/components/calendar/useCalendarLayers';

const BODIES = { month: CalendarMonth, people: CalendarPeople, week: CalendarWeek, day: CalendarDay };

function CalendarBody({ view, ...props }) {
  const Body = BODIES[view];
  return <Body {...props} />;
}

/**
 * The Calendar (ADR 0037): one company-wide calendar. It reads the server's
 * `calendar_entries()` projection and draws each entry from the kind registry,
 * so a new kind of entry never changes this component. The Calendar page,
 * HR's Time Off & Overtime tab and My Requests all render it.
 *
 *   presetLayers  start from these layers (a filtered view) instead of the
 *                 viewer's remembered choice; the choice is then not saved
 *   onWithdraw    when given, the detail panel offers Withdraw on the viewer's
 *                 own approved, upcoming Time Off; called with the entry
 */
export default function Calendar({ presetLayers = null, onWithdraw = null }) {
  const { user } = useAuth();
  const ctx = getPermissionContext(user);
  const canSeePending = ctx.isHr || ctx.isSuperAdmin || ctx.canManageLeaves;

  const [params, setParams] = useSearchParams();
  const { view, date: anchor } = parseCalendarParams(params);
  // Keep any other URL params (e.g. a host page's tab) when the view or date changes.
  const go = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        Object.entries({ view, date: anchor, ...next }).forEach(([k, v]) => out.set(k, v));
        return out;
      },
      { replace: true },
    );
  const [layers, toggleLayer] = useCalendarLayers(presetLayers);
  const [showPending, setShowPending] = useState(false);
  const [selected, setSelected] = useState(null);

  const { from, to } = viewRange(view, anchor);
  // The People view always includes pending for viewers who may see it.
  const includePending = canSeePending && (showPending || view === 'people');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calendar-entries', from, to, includePending],
    queryFn: () => calendarService.fetchEntries({ from, to, includePending }),
  });

  const entries = visibleEntries(data, layers);

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <Button key={v} variant={view === v ? 'secondary' : 'outline'} size="sm" aria-pressed={view === v} onClick={() => go({ view: v })}>
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => go({ date: shiftDate(view, anchor, -1) })} aria-label={`Previous ${view}`}>
          <ChevronLeft size={14} />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold" data-testid="calendar-title">{viewTitle(view, anchor)}</span>
        <Button variant="outline" size="icon-sm" onClick={() => go({ date: shiftDate(view, anchor, 1) })} aria-label={`Next ${view}`}>
          <ChevronRight size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => go({ date: manilaToday() })}>
          Today
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Layers">
        {LAYERS.map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={layers[key] ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={layers[key]}
            onClick={() => toggleLayer(key)}
          >
            <Icon size={13} />
            {label}
          </Button>
        ))}
      </div>
      {canSeePending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch size="sm" checked={showPending} onCheckedChange={setShowPending} aria-label="Show pending" />
          Show pending
        </div>
      )}
    </div>
  );

  return (
    <div>
      {toolbar}
      {error ? (
        <QueryError onRetry={refetch} />
      ) : isLoading ? (
        <PageLoading />
      ) : (
        <CalendarBody view={view} anchor={anchor} entries={entries} onOpenEntry={setSelected} todayYmd={manilaToday()} />
      )}
      <EntryDetail
        entry={selected}
        onClose={() => setSelected(null)}
        entries={entries}
        viewerId={user?.id}
        onWithdraw={onWithdraw}
      />
    </div>
  );
}
