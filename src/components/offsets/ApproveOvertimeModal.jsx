import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { offsetService } from '../../services/offsetService';

/**
 * HR approves an overtime request, editing the hours actually rendered
 * before they're credited — the paper process routinely overrides the
 * requested figure, and the system previously had no way to.
 */
export default function ApproveOvertimeModal({ isOpen, onClose, request, status, hrId, onSuccess }) {
  const [approvedHours, setApprovedHours] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && request) setApprovedHours(String(request.hours));
  }, [isOpen, request]);

  if (!isOpen || !request) return null;

  const isOffset = status === 'APPROVED_OFFSET';
  const parsedHours = parseFloat(approvedHours);
  const isValid = Number.isFinite(parsedHours) && parsedHours > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) {
      toast.error('Enter a valid number of hours greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      await offsetService.handleOvertimeDecision({
        requestId: request.id,
        status,
        approvedHours: parsedHours,
        hrId,
      });
      toast.success(isOffset ? 'Overtime approved as offset.' : 'Overtime approved as paid.');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to approve overtime request.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100005] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-sm rounded-2xl shadow-xl flex flex-col relative overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            {isOffset ? 'Approve as Offset' : 'Approve as Paid OT'}
          </h2>
          <Button
            onClick={onClose}
            variant="ghost" size="icon-xs"
          >
            <X size={18} strokeWidth={2.5} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground">
            {request.employee?.name || 'This employee'} requested {request.hours} hrs on{' '}
            {new Date(request.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
          </p>

          <div>
            <label
              htmlFor="approved-hours"
              className="block text-[11px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wider"
            >
              Approved Hours
            </label>
            <input
              id="approved-hours"
              type="number"
              step="0.5"
              min="0"
              value={approvedHours}
              onChange={(e) => setApprovedHours(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              required
            />
            {isOffset && (
              <p className="text-[11px] font-semibold text-muted-foreground mt-1.5">
                This many hours will be credited to the employee's offset balance.
              </p>
            )}
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
      </div>
    </div>,
    document.body,
  );
}
