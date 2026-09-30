import { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import TabGroup from '../../../../components/ui/TabGroup';
import NotionLeaveCalendar from '../../../../components/hr/NotionLeaveCalendar';
import TeamTimeline from './TeamTimeline';

const CALENDAR_VIEWS = [
  { value: 'month', label: 'Month', icon: CalendarDays },
  { value: 'people', label: 'People', icon: Users },
];

/**
 * The Leaves Manager's Calendar view: the same month of leave shown by day
 * (Month grid) or by person (People timeline). The picked month is shared.
 */
export default function CalendarTab({ approvedLeaves, pendingLeaves, monthStart, initialView = 'month' }) {
  const [view, setView] = useState(initialView === 'people' ? 'people' : 'month');

  return (
    <div className="space-y-4">
      <TabGroup tabs={CALENDAR_VIEWS} activeTab={view} onChange={setView} variant="pill" size="sm" />
      {view === 'people' ? (
        <TeamTimeline approvedLeaves={approvedLeaves} pendingLeaves={pendingLeaves} monthStart={monthStart} />
      ) : (
        <NotionLeaveCalendar approvedLeaves={approvedLeaves} targetDate={monthStart} canViewAllReasons />
      )}
    </div>
  );
}
