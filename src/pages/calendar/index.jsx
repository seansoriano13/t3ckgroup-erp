import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { newActivityLabel } from '@/utils/activityFiling';
import { useCalendarFullScreen } from '@/lib/calendarFullScreen';
import { useActivitySettings } from '@/hooks/useActivitySettings';
import PageShell from '@/components/ui/PageShell';
import SidePanel from '@/components/ui/SidePanel';
import { Button } from '@/components/ui/button';
import Calendar from '@/components/calendar/Calendar';
import MeetingRequestDialog from '@/components/calendar/MeetingRequestDialog';
import MyMeetingRequests from '@/components/calendar/MyMeetingRequests';

/** The Calendar page: the shared board, with the viewer's Activities in a side panel. */
export default function CalendarPage() {
  const { user } = useAuth();
  const activitySettings = useActivitySettings();
  const fullScreen = useCalendarFullScreen();
  const [mineOpen, setMineOpen] = useState(false);
  const [request, setRequest] = useState(null); // null = closed; an object = open, with optional pre-fill
  const openRequest = (initial = {}) => setRequest(initial);

  return (
    <ProtectedRoute>
      <PageShell
        title="Calendar"
        description="Activities, Time Off and overtime across the company."
        hideHeader={fullScreen}
        frame={fullScreen ? 'full' : 'centred'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SidePanel
              label="My Activities"
              icon={ListChecks}
              inlineFrom={100000}
              width="26rem"
              open={mineOpen}
              onOpenChange={setMineOpen}
            >
              <div className="p-4">
                <MyMeetingRequests />
              </div>
            </SidePanel>
            <Button onClick={() => openRequest()}>{newActivityLabel(user, activitySettings)}</Button>
          </div>
        }
      >
        <Calendar onPickSlot={openRequest} allowFullScreen />
        <MeetingRequestDialog open={Boolean(request)} initial={request ?? undefined} onClose={() => setRequest(null)} />
      </PageShell>
    </ProtectedRoute>
  );
}
