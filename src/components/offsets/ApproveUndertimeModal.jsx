import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { offsetService } from '../../services/offsetService';

/**
 * HR decides an undertime request, editing the hours actually charged
 * before they're recorded — mirrors ApproveOvertimeModal, but there is no
 * paid/offset choice to make here (undertime never moves a balance either
 * way): just Approve or Reject, with an editable approved-hours field on
 * approval.
 */
export default function ApproveUndertimeModal({ isOpen, onClose, request, status, hrId, onSuccess }) {
  const [approvedHours, setApprovedHours] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && request) setApprovedHours(String(request.hours));
  }, [isOpen, request]);

  if (!isOpen || !request) return null;

  const isApprove = status === 'APPROVED';
  const parsedHours = parseFloat(approvedHours);
  const isValid = !isApprove || (Number.isFinite(parsedHours) && parsedHours > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isValid) {
      toast.error('Enter a valid number of hours greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      await offsetService.handleUndertimeDecision({
        requestId: request.id,
        status,
        approvedHours: isApprove ? parsedHours : null,
        hrId,
      });
      toast.success(isApprove ? 'Undertime approved.' : 'Undertime rejected.');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to decide undertime request.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100005] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-sm rounded-2xl shadow-xl flex flex-col relative overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/30">
          <h2 className="text-sm font-black text-foreground tracking-wide uppercase">
            {isApprove ? 'Approve Undertime' : 'Reject Undertime'}
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
            {request.employee?.name || 'This employee'} filed {request.hours} hrs of undertime on{' '}
            {new Date(request.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
          </p>

          {isApprove && (
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
              <p className="text-[11px] font-semibold text-muted-foreground mt-1.5">
                Undertime never credits or debits any balance — this figure is recorded only.
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || !isValid}
            className="w-full h-11 rounded-xl font-bold shadow-md cursor-pointer"
          >
            {isApprove ? <CheckCircle2 size={16} className="mr-1.5" /> : <XCircle size={16} className="mr-1.5" />}
            {submitting ? 'Saving...' : isApprove ? 'Confirm Approval' : 'Confirm Rejection'}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
