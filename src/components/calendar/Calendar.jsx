import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { Button } from '@/components/ui/button';
import FilterBar from '@/components/ui/FilterBar';
import SidePanel from '@/components/ui/SidePanel';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { getPermissionContext } from '@/utils/permissions';
import { manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import CalendarMonth from '@/components/calendar/CalendarMonth';
import CalendarAgenda from '@/components/calendar/CalendarAgenda';
import CalendarGantt from '@/components/calendar/CalendarGantt';
import DayRail from '@/components/calendar/DayRail';
import EntryDetail from '@/components/calendar/EntryDetail';
import { KindKey, LayerToggles, LayoutSwitch, NavArrows, PendingSwitch } from '@/components/calendar/calendarParts.jsx';
import { visibleEntries } from '@/components/calendar/entryKinds.jsx';
import { withSpan } from '@/components/calendar/entrySpan.js';
import { GANTT_WEEKS, ganttDays, layoutRange, layoutTitle, parseCalendarParams, shiftDate } from '@/components/calendar/calendarNav.js';
import { useCalendarLayers } from '@/components/calendar/useCalendarLayers';
import { ENTRY_PARAM, entryAddress, matchesAddress, parseEntryAddress } from '@/components/calendar/entryAddress.js';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import { useIsPhone, useRoomy } from "@/hooks/useScreenBand";

const LAYOUT_KEY = 'calendar.layout';
// The same test SidePanel uses for its inline column (inlineFrom 1440, over 700px tall).

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
  const parsed = parseCalendarParams(params, manilaToday(), rememberedLayout());
  const { date: anchor, weeks } = parsed;
  const phone = useIsPhone();
  const roomy = useRoomy();
  // The Gantt needs room; a phone always gets the month, as an Agenda.
  const layout = phone ? 'calendar' : parsed.layout;
  const ganttHidden = phone && parsed.layout === 'gantt';
  const [panelOpen, setPanelOpen] = useState(false);
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
  // The open entry is the address's `?entry=<kind>:<id>`: opening writes it (a new
  // history step, or a replace when another entry is already open), closing clears it.
  const wanted = parseEntryAddress(params.get(ENTRY_PARAM));
  const found = wanted ? all.find((e) => matchesAddress(e, wanted)) : null;
  const selected = found ? withSpan(found, entries) : null;
  // An entry opened by a push from this page is closed by stepping Back, so Back
  // leaves the Calendar's open entry rather than replaying it. One that arrived by
  // a link (or was swapped for another) has no such step, so it just drops the address.
  const location = useLocation();
  const navigate = useNavigate();
  const openedHere = location.state?.entryOpenedHere === true;
  const open = (e) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set(ENTRY_PARAM, entryAddress(e));
        return out;
      },
      { replace: Boolean(wanted), state: wanted ? location.state : { entryOpenedHere: true } },
    );
  const closeEntry = () => {
    if (openedHere) {
      navigate(-1);
      return;
    }
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete(ENTRY_PARAM);
        return out;
      },
      { replace: true },
    );
  };
  // An address for an entry outside the month on screen: look its date up, then move there.
  const lookupDate = Boolean(wanted) && !found && !isLoading && !error;
  const { data: entryDate, isFetched: dateFetched } = useQuery({
    queryKey: ['calendar-entry-date', wanted?.kind, wanted?.id],
    queryFn: () => calendarService.fetchEntryDate(wanted),
    enabled: lookupDate,
  });
  const outOfView = lookupDate && Boolean(entryDate) && (entryDate < from || entryDate > to);
  useEffect(() => {
    if (outOfView) go({ date: entryDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outOfView, entryDate]);
  const entryMissing = lookupDate && dateFetched && !outOfView;
  const gantt = layout === 'gantt';
  const dayEntries = entries.filter((e) => e.manila_date === anchor);
  const dayDate = parseManilaDate(anchor);
  const dayLabel = `${anchor === todayYmd ? 'Today' : format(dayDate, 'EEE')} · ${format(dayDate, 'MMM d')}`;
  const openDay = (ymd) => {
    go({ date: ymd });
    setPanelOpen(true);
  };
  const dayRail = (
    <DayRail
      ymd={anchor}
      entries={entries}
      layers={layers}
      venues={venues}
      todayYmd={todayYmd}
      onOpenEntry={open}
      onPickSlot={onPickSlot}
      framed={roomy}
    />
  );
  const unit = gantt ? 'week' : 'month';

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {!phone && <LayoutSwitch layout={layout} onChange={pickLayout} />}
      <h2 className="min-w-28 text-lg font-black tracking-tight" data-testid="calendar-title">
        {layoutTitle(layout, anchor, weeks)}
      </h2>
      <NavArrows
        unit={unit}
        onPrev={() => go({ date: shiftDate(layout, anchor, -1) })}
        onNext={() => go({ date: shiftDate(layout, anchor, 1) })}
        onToday={() => go({ date: todayYmd })}
      />
      {gantt && <WeeksSwitch weeks={weeks} onChange={(n) => go({ weeks: String(n) })} />}
      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
        <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
        {canSeePending && (
          <FilterBar
            className="w-auto flex-none sm:flex-none"
            filters={<PendingSwitch showPending={showPending} setShowPending={setShowPending} />}
            activeCount={showPending ? 1 : 0}
          />
        )}
        {!gantt && !roomy && (
          <SidePanel
            label={dayLabel}
            icon={CalendarDays}
            badge={dayEntries.length}
            open={panelOpen}
            onOpenChange={setPanelOpen}
          >
            {dayRail}
          </SidePanel>
        )}
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
  else if (phone)
    body = (
      <CalendarAgenda
        anchor={anchor}
        entries={entries}
        todayYmd={todayYmd}
        selectedYmd={anchor}
        onSelectDay={(ymd) => go({ date: ymd })}
        onOpenDay={openDay}
        onOpenEntry={open}
        loading={isLoading ? <PageLoading /> : null}
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
        onOpenDay={openDay}
        onOpenEntry={open}
        loading={isLoading ? <PageLoading /> : null}
      />
    );

  return (
    <div className="pb-16 laptop:pb-8">
      {gantt ? (
        <div className="flex min-w-0 flex-col gap-4">
          {toolbar}
          {entryMissing && <p className="text-sm text-muted-foreground" role="status">Not found. This entry is no longer on the Calendar.</p>}
          {body}
          <KindKey />
        </div>
      ) : (
        <div className="flex items-start gap-6">
          <section className="flex min-w-0 flex-1 flex-col gap-3">
            {toolbar}
            {entryMissing && <p className="text-sm text-muted-foreground" role="status">Not found. This entry is no longer on the Calendar.</p>}
            {ganttHidden && <p className="text-sm text-muted-foreground">Gantt needs a wider screen.</p>}
            {body}
            <KindKey />
          </section>
          {roomy && (
            <SidePanel label={dayLabel} inlineFrom={1440} width="20rem" className="sticky top-4">
              {dayRail}
            </SidePanel>
          )}
        </div>
      )}
      <EntryDetail entry={selected} onClose={closeEntry} entries={entries} viewerId={user?.id} onWithdraw={onWithdraw} />
    </div>
  );
}
