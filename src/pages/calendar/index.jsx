import { useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import PageShell from '@/components/ui/PageShell';
import { Button } from '@/components/ui/button';
import TabGroup from '@/components/ui/TabGroup';
import Calendar from '@/components/calendar/Calendar';
import MeetingRequestDialog from '@/components/calendar/MeetingRequestDialog';
import MyMeetingRequests from '@/components/calendar/MyMeetingRequests';

/** The Calendar page: the shared Calendar, plus the viewer's Meeting Requests. */
export default function CalendarPage() {
  const [tab, setTab] = useState('calendar');
  const [request, setRequest] = useState(null); // null = closed; an object = open, with optional pre-fill
  const openRequest = (initial = {}) => setRequest(initial);

  return (
    <ProtectedRoute>
      <PageShell
        title="Calendar"
        description="Meetings, Time Off and overtime across the company."
        action={<Button onClick={() => openRequest()}>New Meeting Request</Button>}
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
      >
        {tab === 'mine' ? <MyMeetingRequests /> : <Calendar onPickSlot={openRequest} />}
        <MeetingRequestDialog open={Boolean(request)} initial={request ?? undefined} onClose={() => setRequest(null)} />
      </PageShell>
    </ProtectedRoute>
  );
}
