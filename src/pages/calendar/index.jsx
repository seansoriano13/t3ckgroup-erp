import ProtectedRoute from '@/components/ProtectedRoute';
import PageShell from '@/components/ui/PageShell';
import Calendar from '@/components/calendar/Calendar';

/** The Calendar page: the shared Calendar, with the layers the viewer last chose. */
export default function CalendarPage() {
  return (
    <ProtectedRoute>
      <PageShell title="Calendar" description="Time Off and overtime across the company.">
        <Calendar />
      </PageShell>
    </ProtectedRoute>
  );
}
