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
  const [requestOpen, setRequestOpen] = useState(false);

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
      >
        {tab === 'mine' ? <MyMeetingRequests /> : <Calendar />}
        <MeetingRequestDialog open={requestOpen} onClose={() => setRequestOpen(false)} />
      </PageShell>
    </ProtectedRoute>
  );
}
