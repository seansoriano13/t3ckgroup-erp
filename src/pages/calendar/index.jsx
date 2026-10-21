import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addMonths, format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import PageShell from '@/components/ui/PageShell';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { getPermissionContext } from '@/utils/permissions';
import { manilaDate, manilaToday, parseManilaDate } from '@/lib/manilaDate.js';
import MeetingRequestDialog from '@/components/calendar/MeetingRequestDialog';
import MyMeetingRequests from '@/components/calendar/MyMeetingRequests';
import TabGroup from '@/components/ui/TabGroup';
import CalendarMonth from '@/components/calendar/CalendarMonth';
import EntryDetail from '@/components/calendar/EntryDetail';
import { LAYERS, visibleEntries } from '@/components/calendar/entryKinds.jsx';
import { monthRange } from '@/components/calendar/monthWeeks.js';
import { useCalendarLayers } from '@/components/calendar/useCalendarLayers';

/**
 * The Calendar (ADR 0037): one company-wide calendar. It reads the server's
 * `calendar_entries()` projection and draws each entry from the kind registry,
 * so a new kind of entry never changes this page.
 */
export default function CalendarPage() {
  const { user } = useAuth();
  const ctx = getPermissionContext(user);
  const canSeePending = ctx.isHr || ctx.isSuperAdmin || ctx.canManageLeaves;

  const [anchor, setAnchor] = useState(() => manilaToday().slice(0, 8) + '01');
  const [layers, toggleLayer] = useCalendarLayers();
  const [showPending, setShowPending] = useState(false);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('calendar');
  const [requestOpen, setRequestOpen] = useState(false);

  const { from, to } = monthRange(anchor);
  const includePending = canSeePending && showPending;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calendar-entries', from, to, includePending],
    queryFn: () => calendarService.fetchEntries({ from, to, includePending }),
  });

  const shiftMonth = (by) => setAnchor(manilaDate(addMonths(parseManilaDate(anchor), by)));
  const entries = visibleEntries(data, layers);

  const toolbar = (
    <>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          <ChevronLeft size={14} />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold">{format(parseManilaDate(anchor), 'MMMM yyyy')}</span>
        <Button variant="outline" size="icon-sm" onClick={() => shiftMonth(1)} aria-label="Next month">
          <ChevronRight size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(manilaToday().slice(0, 8) + '01')}>
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
    </>
  );

  return (
    <ProtectedRoute>
      <PageShell
        title="Calendar"
        description="Meetings, Time Off and overtime across the company."
        action={<Button onClick={() => setRequestOpen(true)}>New Meeting Request</Button>}
        tabs={
          <TabGroup
            tabs={[
              { value: 'calendar', label: 'Calendar' },
              { value: 'mine', label: 'My Meeting Requests' },
            ]}
            activeTab={tab}
            onChange={setTab}
          />
        }
        toolbar={tab === 'calendar' ? toolbar : undefined}
      >
        {tab === 'mine' ? (
          <MyMeetingRequests />
        ) : error ? (
          <QueryError onRetry={refetch} />
        ) : isLoading ? (
          <PageLoading />
        ) : (
          <CalendarMonth anchor={anchor} entries={entries} onOpenEntry={setSelected} todayYmd={manilaToday()} />
        )}
        <EntryDetail entry={selected} onClose={() => setSelected(null)} />
        <MeetingRequestDialog open={requestOpen} onClose={() => setRequestOpen(false)} />
      </PageShell>
    </ProtectedRoute>
  );
}
