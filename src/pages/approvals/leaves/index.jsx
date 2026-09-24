import { useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { headApprovalService, decideHeadApproval } from '../../../services/headApprovalService';
import ProtectedRoute from '../../../components/ProtectedRoute';
import PageContainer from '../../../components/ui/PageContainer';
import { Button } from '../../../components/ui/button';
import { Check, X, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import Spinner from '@/components/ui/Spinner';

import { Textarea } from "@/components/ui/textarea";
const REQUEST_LABEL = { SIL: 'SIL Leave', OFFSET: 'Offset Leave', OVERTIME: 'Overtime', UNDERTIME: 'Undertime' };

/**
 * Head-facing queue for the department-head approval stage (issue #137):
 * every sil/offset/overtime request routed to the signed-in head and still
 * waiting on their decision, with a one-click Approve/Reject.
 */
function LeaveApprovalsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [noteDraft, setNoteDraft] = useState({});

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['headPendingApprovals', user?.id],
    queryFn: () => headApprovalService.getPendingForHead(user.id),
    enabled: !!user?.id,
  });

  const decide = useMutation({
    mutationFn: ({ item, status }) =>
      decideHeadApproval({
        table: item.table,
        matchColumn: item.matchColumn,
        matchValue: item.matchValue,
        headId: user.id,
        status,
        headNote: noteDraft[item.matchValue] || '',
      }),
    onSuccess: (_data, { status }) => {
      toast.success(status === 'APPROVED' ? 'Approved.' : 'Rejected.');
      queryClient.invalidateQueries({ queryKey: ['headPendingApprovals'] });
    },
    onError: (err) => toast.error(err.message || 'Failed to record decision.'),
  });

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-lg font-black text-foreground tracking-tight">Leave &amp; Overtime Approvals</h1>
        <p className="text-sm text-muted-foreground font-medium mt-1">
          Requests routed to you as department head, awaiting your decision before HR can act on them.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="md" /></div>
      ) : pending.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Clock className="mx-auto mb-3 opacity-40" size={32} />
          <p className="text-sm font-semibold">Nothing waiting on you right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((item) => (
            <div key={`${item.table}-${item.matchValue}-${item.id}`} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {REQUEST_LABEL[item.requestType] || item.requestType}
                    </span>
                    <span className="text-sm font-bold text-foreground">{item.employee?.name || 'Unknown'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.date} · {item.hours ? `${item.hours} hrs` : ''} {item.start_time && item.end_time ? `(${item.start_time}–${item.end_time})` : ''}
                  </p>
                  {item.reason && <p className="text-xs text-foreground/80 mt-1">{item.reason}</p>}
                </div>
              </div>
              <Textarea
                placeholder="Optional note..."
                value={noteDraft[item.matchValue] || ''}
                onChange={(e) => setNoteDraft((prev) => ({ ...prev, [item.matchValue]: e.target.value }))}
                rows={2}
                className="min-h-0 resize-none rounded-lg px-3 py-2 text-xs md:text-xs font-medium"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ item, status: 'REJECTED' })}
                  className="text-red-11 border-red-6 hover:bg-red-3 cursor-pointer"
                >
                  <X size={14} /> Reject
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ item, status: 'APPROVED' })}
                  className="cursor-pointer"
                >
                  <Check size={14} /> Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export default function ProtectedLeaveApprovalsPage() {
  return (
    <ProtectedRoute requireHead>
      <LeaveApprovalsPage />
    </ProtectedRoute>
  );
}
