import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/context/AuthContext';
import { meetingRequestService } from '@/services/meetingRequestService';
import { getPermissionContext } from '@/utils/permissions';
import MeetingRequestDialog from './MeetingRequestDialog';
import { meetingActions } from './meetingActions.js';

/**
 * Edit, Send again and Cancel for one Meeting Request (#628). Each button shows only when allowed.
 * `request` is { id, status, startsAt, applicantId }; `onDone` runs after any action succeeds.
 */
export default function MeetingActions({ request, onDone, allowHr = true }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const ctx = getPermissionContext(user);
  const allowed = meetingActions({ ...request, viewerId: user?.id, isHr: allowHr && (ctx.isHr || ctx.isSuperAdmin) });
  const [form, setForm] = useState(null); // 'edit' | 'resend'
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const { data: full } = useQuery({
    queryKey: ['meeting-requests', 'one', request.id],
    queryFn: () => meetingRequestService.getRequest(request.id),
    enabled: Boolean(form),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar-entries'] });
    queryClient.invalidateQueries({ queryKey: ['meeting-requests'] });
    onDone?.();
  };

  const cancel = useMutation({
    mutationFn: () => meetingRequestService.cancel({ requestId: request.id, reason: reason.trim(), actor: user }),
    onSuccess: () => {
      toast.success('Meeting Request cancelled.');
      setReason('');
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!allowed.edit && !allowed.resend && !allowed.cancel && !allowed.hrCancel) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="meeting-actions">
      {allowed.resend && (
        <Button size="sm" onClick={() => setForm('resend')}>
          Send again
        </Button>
      )}
      {allowed.edit && (
        <Button size="sm" variant="outline" onClick={() => setForm('edit')}>
          Edit
        </Button>
      )}
      {(allowed.cancel || allowed.hrCancel) && (
        <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
          Cancel
        </Button>
      )}
      {form && full && (
        <MeetingRequestDialog
          open
          editing={full}
          resend={form === 'resend'}
          onClose={(saved) => {
            setForm(null);
            if (saved) refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this Meeting Request?"
        description="The Venue is freed at once. This cannot be undone."
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        tone="destructive"
        confirmDisabled={allowed.hrCancel && !reason.trim()}
        onConfirm={() => cancel.mutate()}
      >
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={allowed.hrCancel ? 'Reason (required)' : 'Reason (optional)'}
        />
      </ConfirmDialog>
    </div>
  );
}
