import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { getPermissionContext } from '@/utils/permissions';
import { manilaToday } from '@/lib/manilaDate.js';
import CalendarMonth from '@/components/calendar/CalendarMonth';
import CalendarGantt from '@/components/calendar/CalendarGantt';
import DayRail from '@/components/calendar/DayRail';
import EntryDetail from '@/components/calendar/EntryDetail';
import { KindKey, LayerToggles, LayoutSwitch, NavArrows, PendingSwitch } from '@/components/calendar/calendarParts.jsx';
import { visibleEntries } from '@/components/calendar/entryKinds.jsx';
import { withSpan } from '@/components/calendar/entrySpan.js';
import { GANTT_WEEKS, ganttDays, layoutRange, layoutTitle, parseCalendarParams, shiftDate } from '@/components/calendar/calendarNav.js';
import { useCalendarLayers } from '@/components/calendar/useCalendarLayers';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';

const LAYOUT_KEY = 'calendar.layout';

function rememberedLayout() {
  try {
    return window.localStorage.getItem(LAYOUT_KEY);
  } catch {
    return null;
  }
}

function WeeksSwitch({ weeks, onChange }) {
  return (
    <div className="flex rounded-xl bg-muted p-1" role="group" aria-label="Range">
      {GANTT_WEEKS.map((n) => (
        <Button
          key={n}
          variant="ghost"
          size="sm"
          aria-pressed={weeks === n}
          onClick={() => onChange(n)}
          className={cn('rounded-lg px-3 font-semibold', weeks === n ? 'bg-card text-foreground shadow-sm hover:bg-card' : 'text-muted-foreground')}
        >
          {n} weeks
        </Button>
      ))}
    </div>
  );
}

/**
 * The Calendar (ADR 0037): one company-wide calendar. It reads the server's
 * `calendar_entries()` projection and draws each entry from the kind registry,
 * so a new kind of entry never changes this component. The Calendar page,
 * HR's Time Off & Overtime tab and My Requests all render it.
 *
 * Two layouts, picked with the Calendar | Gantt switch (`?layout=`, and
 * remembered in this browser): the month with the selected day in a rail
 * beside it, and a Gantt of rooms and people across two or four weeks. The
 * selected date lives in `?date=`, the Gantt's range in `?weeks=`.
 *
 *   presetLayers  start from these layers (a filtered view) instead of the
 *                 viewer's remembered choice; the choice is then not saved
 *   onWithdraw    when given, the detail panel offers Withdraw on the viewer's
 *                 own approved, upcoming Time Off; called with the entry
 *   onPickSlot    when given, rooms can be booked from the rail and the Gantt;
 *                 called with a pre-fill for the request form
 */
export default function Calendar({ presetLayers = null, onWithdraw = null, onPickSlot = null }) {
  const { user } = useAuth();
  const ctx = getPermissionContext(user);
  useMeetingRealtime();
  const canSeePending = ctx.isHr || ctx.isSuperAdmin || ctx.canManageLeaves;

  const [params, setParams] = useSearchParams();
  const { layout, date: anchor, weeks } = parseCalendarParams(params, manilaToday(), rememberedLayout());
  // Keep any other URL params (e.g. a host page's tab) when the layout or date changes.
  const go = (next) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        Object.entries({ layout, date: anchor, ...next }).forEach(([k, v]) => out.set(k, v));
        if (out.get('layout') !== 'gantt') out.delete('weeks');
        out.delete('view'); // the old Month / People / Week / Day param
        return out;
      },
      { replace: true },
    );
  const pickLayout = (key) => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, key);
    } catch {
      // Not remembered; the URL still carries it.
    }
    go({ layout: key });
  };

  const [layers, toggleLayer] = useCalendarLayers(presetLayers);
  const [showPending, setShowPending] = useState(false);
  const [selected, setSelected] = useState(null);
  const todayYmd = manilaToday();

  const { data: venues = [] } = useQuery({
    queryKey: ['calendar-venues'],
    queryFn: () => meetingRequestService.listVenues(),
    enabled: Boolean(layers.meetings),
  });

  const { from, to } = layoutRange(layout, anchor, weeks);
  const includePending = canSeePending && showPending;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calendar-entries', from, to, includePending],
    queryFn: () => calendarService.fetchEntries({ from, to, includePending }),
  });

  const all = data ?? [];
  const entries = visibleEntries(all, layers);
  const open = (e) => setSelected(withSpan(e, entries));
  const gantt = layout === 'gantt';
  const unit = gantt ? 'week' : 'month';

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <LayoutSwitch layout={layout} onChange={pickLayout} />
      <h2 className="min-w-40 text-xl font-black tracking-tight" data-testid="calendar-title">
        {layoutTitle(layout, anchor, weeks)}
      </h2>
      <NavArrows
        unit={unit}
        onPrev={() => go({ date: shiftDate(layout, anchor, -1) })}
        onNext={() => go({ date: shiftDate(layout, anchor, 1) })}
        onToday={() => go({ date: todayYmd })}
      />
      {gantt && <WeeksSwitch weeks={weeks} onChange={(n) => go({ weeks: String(n) })} />}
      <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
        <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
        {canSeePending && <PendingSwitch showPending={showPending} setShowPending={setShowPending} />}
      </div>
    </div>
  );

  let body;
  if (error) body = <QueryError onRetry={refetch} />;
  else if (gantt)
    body = isLoading ? (
      <PageLoading />
    ) : (
      <CalendarGantt
        days={ganttDays(anchor, weeks)}
        entries={entries}
        layers={layers}
        venues={venues}
        todayYmd={todayYmd}
        selectedYmd={anchor}
        onOpenEntry={open}
        onPickSlot={onPickSlot}
      />
    );
  else
    body = (
      <CalendarMonth
        anchor={anchor}
        entries={entries}
        todayYmd={todayYmd}
        selectedYmd={anchor}
        onSelectDay={(ymd) => go({ date: ymd })}
        onOpenEntry={open}
        loading={isLoading ? <PageLoading /> : null}
      />
    );

  return (
    <div className="pb-16">
      {gantt ? (
        <div className="flex min-w-0 flex-col gap-4">
          {toolbar}
          {body}
          <KindKey />
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex min-w-0 flex-col gap-4">
            {toolbar}
            {body}
            <KindKey />
          </section>
          <DayRail
            ymd={anchor}
            entries={entries}
            layers={layers}
            venues={venues}
            todayYmd={todayYmd}
            onOpenEntry={open}
            onPickSlot={onPickSlot}
          />
        </div>
      )}
      <EntryDetail entry={selected} onClose={() => setSelected(null)} entries={entries} viewerId={user?.id} onWithdraw={onWithdraw} />
    </div>
  );
}
