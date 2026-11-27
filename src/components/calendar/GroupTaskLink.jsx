import { useQuery } from '@tanstack/react-query';
import { meetingRequestService } from '@/services/meetingRequestService';
import { openRecordWindow } from '@/utils/recordLink';
import { Button } from '@/components/ui/button';

/** Open Group Task, shown only when the viewer's own read of that Group Task finds it. */
export default function GroupTaskLink({ groupTaskId }) {
  const { data: openable } = useQuery({
    queryKey: ['group-task-openable', groupTaskId],
    queryFn: () => meetingRequestService.groupTaskOpenable(groupTaskId),
    enabled: Boolean(groupTaskId),
  });
  if (!groupTaskId || !openable) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => openRecordWindow({ id: groupTaskId, type: 'GROUP_TASK' })}>
      Open Group Task
    </Button>
  );
}
