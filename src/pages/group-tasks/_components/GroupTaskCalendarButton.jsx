import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import MeetingRequestDialog from "@/components/calendar/MeetingRequestDialog";
import { meetingRequestService } from "@/services/meetingRequestService";
import { useActivitySettings } from "@/hooks/useActivitySettings";
import { dueDateInputValue } from "../utils/dueCountdown";
import { calendarButtonState, dayToOpen } from "@/utils/groupTaskActivity";

/**
 * #1250 (spec #1246): the Group Task window's Calendar button. Add to Calendar opens the Activity form filled
 * in from the Group Task; once a live Activity exists it reads Open in Calendar (even if the type was switched
 * off later); otherwise nothing.
 */
export default function GroupTaskCalendarButton({ task }) {
  const navigate = useNavigate();
  const settings = useActivitySettings();
  const [adding, setAdding] = useState(false);
  const { data: live = null, isSuccess } = useQuery({
    queryKey: ["group-task-live-activity", task.id],
    queryFn: () => meetingRequestService.liveGroupTaskActivity(task.id),
  });
  if (!isSuccess) return null;
  const state = calendarButtonState({ liveActivity: live, typeOn: settings.types.GROUP_TASK?.active, taskStatus: task.status });
  if (!state) return null;

  if (state === "open") {
    const dayId = dayToOpen(live.days);
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/calendar?entry=meeting:${encodeURIComponent(dayId ?? live.id)}`)}>
        <CalendarCheck size={14} /> Open in Calendar
      </Button>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
        <CalendarPlus size={14} /> Add to Calendar
      </Button>
      {adding && (
        <MeetingRequestDialog
          open
          onClose={() => setAdding(false)}
          initial={{
            groupTask: {
              id: task.id,
              title: task.title,
              memberIds: (task.members ?? []).map((m) => m.employee_id),
              startDate: task.start_date || "",
              dueDate: dueDateInputValue(task.due_date),
            },
          }}
        />
      )}
    </>
  );
}
