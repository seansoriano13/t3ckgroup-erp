import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import toast from 'react-hot-toast';
import { X, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { offsetService } from '../../services/offsetService';
import { Input } from "@/components/ui/input";
import { AttachmentList } from '../ui/Attachments';
import { FieldBox } from "@/components/ui/FieldBox";

/**
 * HR approves an offset leave request, editing the hours actually debited
 * before the employee's balance is spent — mirrors ApproveOvertimeModal, but
 * capped at the requested hours since this spends a banked balance rather
 * than crediting one. `request` is a grouped entry (groupLeaveRows), so the
 * hours are the application's total across all its days.
 */
export default function ApproveOffsetModal({ isOpen, onClose, request, hrId, onSuccess }) {
  const [approvedHours, setApprovedHours] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && request) setApprovedHours(String(request.hours));
  }, [isOpen, request]);

  if (!isOpen || !request) return null;

  const parsedHours = parseFloat(approvedHours);
  const isValid = Number.isFinite(parsedHours) && parsedHours > 0 && parsedHours <= request.hours;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) {
      toast.error(`Enter a number of hours greater than zero and no more than ${request.hours}.`);
      return;
    }

    setSubmitting(true);
    try {
      await offsetService.handleOffsetLeaveDecision({
        groupId: request.leave_group_id,
        status: 'APPROVED',
        approvedHours: parsedHours,
        hrId,
      });
      toast.success('Offset approved.');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to approve Offset request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-sm sm:max-w-sm flex flex-col overflow-hidden p-0 gap-0">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            Approve Offset
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="h-auto w-auto text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X size={18} strokeWidth={2.5} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground">
            {request.employee?.name || 'This employee'} requested {request.hours} hrs
            {request.dayCount > 1 ? ` across ${request.dayCount} days from ` : ' on '}
            {new Date(request.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
          </p>

          {request.attachments?.length > 0 && (
            <AttachmentList attachments={request.attachments} />
          )}

          <div>
            <FieldBox label="Approved Hours" htmlFor="approved-offset-hours" className="block mb-1.5" />
            <Input
              id="approved-offset-hours"
              type="number"
              step="0.5"
              min="0"
              max={request.hours}
              value={approvedHours}
              onChange={(e) => setApprovedHours(e.target.value)}
              containerClassName="w-full" className="font-semibold"
              required
            />
            <p className="text-[11px] font-semibold text-muted-foreground mt-1.5">
              This many hours will be deducted from the employee's offset balance. Cannot exceed the {request.hours} hrs requested.
            </p>
          </div>

          <Button
            type="submit"
            disabled={submitting || !isValid}
            className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer"
          >
            <CheckCircle2 size={16} className="mr-1.5" />
            {submitting ? 'Approving...' : 'Confirm Approval'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
