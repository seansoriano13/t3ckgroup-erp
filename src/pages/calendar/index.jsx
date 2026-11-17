import { useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { newActivityLabel } from '@/utils/activityFiling';
import { useActivitySettings } from '@/hooks/useActivitySettings';
import PageShell from '@/components/ui/PageShell';
import { Button } from '@/components/ui/button';
import TabGroup from '@/components/ui/TabGroup';
import Calendar from '@/components/calendar/Calendar';
import MeetingRequestDialog from '@/components/calendar/MeetingRequestDialog';
import MyMeetingRequests from '@/components/calendar/MyMeetingRequests';

/** The Calendar page: the shared Calendar, plus the viewer's Activities. */
export default function CalendarPage() {
  const { user } = useAuth();
  const activitySettings = useActivitySettings();
  const [tab, setTab] = useState('calendar');
  const [request, setRequest] = useState(null); // null = closed; an object = open, with optional pre-fill
  const openRequest = (initial = {}) => setRequest(initial);

  return (
    <ProtectedRoute>
      <PageShell
        title="Calendar"
        description="Activities, Time Off and overtime across the company."
        action={<Button onClick={() => openRequest()}>{newActivityLabel(user, activitySettings)}</Button>}
        tabs={
          <TabGroup
            tabs={[
              { value: 'calendar', label: 'Calendar' },
              { value: 'mine', label: 'My Activities' },
            ]}
            activeTab={tab}
            onChange={setTab}
          />
        }
      >
        {tab === 'mine' ? <MyMeetingRequests /> : <Calendar onPickSlot={openRequest} />}
        <MeetingRequestDialog open={Boolean(request)} initial={request ?? undefined} onClose={() => setRequest(null)} />
      </PageShell>
    </ProtectedRoute>
  );
}
