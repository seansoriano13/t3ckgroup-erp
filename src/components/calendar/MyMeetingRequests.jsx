import { useQuery } from '@tanstack/react-query';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import { useAuth } from '@/context/AuthContext';
import PageLoading from '@/components/ui/PageLoading';
import QueryError from '@/components/ui/QueryError';
import { MEETING_STATUS_LABEL, meetingPlace, meetingRequestService } from '@/services/meetingRequestService';
import MeetingActions from './MeetingActions.jsx';
import { formatManilaDateTime, manilaTime } from '@/lib/manilaDate.js';

/** "My Meeting Requests": every request I filed, run as Facilitator, or am a Participant in, with its status and history. */
export default function MyMeetingRequests() {
  const { user } = useAuth();
  useMeetingRealtime();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['meeting-requests', 'mine', user?.id],
    queryFn: () => meetingRequestService.listMine(user.id),
    enabled: Boolean(user?.id),
  });

  if (error) return <QueryError onRetry={refetch} />;
  if (isLoading) return <PageLoading />;
  if (!data?.length) return <p className="py-8 text-center text-sm text-muted-foreground">No Meeting Requests yet.</p>;

  return (
    <ul className="flex flex-col gap-2" data-testid="my-meeting-requests">
      {data.map((r) => (
        <li key={r.id} className="rounded-lg border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{r.purpose}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
              {MEETING_STATUS_LABEL[r.status] ?? r.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {meetingPlace(r)} · {formatManilaDateTime(r.starts_at)} to {manilaTime(r.ends_at)} · Facilitator {r.facilitator?.name}
          </p>
          {r.return_note && r.status === 'RETURNED' && <p className="mt-1 text-xs">Returned: {r.return_note}</p>}
          {r.cancel_reason && r.status === 'CANCELLED' && <p className="mt-1 text-xs">Cancelled: {r.cancel_reason}</p>}
          <div className="mt-2">
            <MeetingActions allowHr={false} request={{ id: r.id, status: r.status, startsAt: r.starts_at, applicantId: r.applicant_id }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
