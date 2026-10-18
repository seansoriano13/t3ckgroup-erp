import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, BadgeCheck } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { canvassService } from "../services/canvassService";
import { moreOffersWarning } from "../utils/canvassMath";

/**
 * Signing a Canvass off (#279): the purchasing approver reads the winner and the reason, sees the
 * under-three warning when there is one (it never blocks), and confirms. The same dialog serves the
 * Canvass panel and the Approval Center queue, so it takes a plain summary rather than a Canvass:
 * the queue's list member may not be able to read the Costing Matrix at all.
 *
 * `summary`: { id, number, subjectLabel, reason, offerCount, winnerLabel }.
 */
export default function CanvassSignoffDialog({ open, onOpenChange, summary, onSigned }) {
  const reason = String(summary?.reason ?? "").trim();
  const warning = moreOffersWarning(new Array(summary?.offerCount ?? 0));

  const signMutation = useMutation({
    mutationFn: () => canvassService.sign(summary.id),
    onSuccess: (result) => {
      toast.success(`${result?.number || summary.number} signed off.`);
      onSigned?.(result);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck size={16} aria-hidden="true" />
            Sign off Canvass {summary?.number}
          </DialogTitle>
          <DialogDescription>
            {summary?.subjectLabel ? `${summary.subjectLabel}. ` : ""}Your signature says you approve the supplier and product chosen below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-0.5">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Winner</span>
            <p className="font-semibold text-foreground">{summary?.winnerLabel || "—"}</p>
          </div>

          <div className="space-y-0.5">
            <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>Why this supplier</span>
            {reason ? (
              <p className="whitespace-pre-wrap text-foreground" data-testid="signoff-reason">{reason}</p>
            ) : (
              <p className="text-red-11" data-testid="signoff-reason-missing">
                No reason has been given, so this can't be signed yet.
              </p>
            )}
          </div>

          {warning && (
            <p
              className="flex items-start gap-1.5 rounded-lg bg-amber-a3 px-2.5 py-2 text-[13px] font-semibold text-amber-11"
              role="alert"
              data-testid="signoff-warning"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {warning}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-auto px-3 py-1.5 text-[12px] font-semibold">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!reason || signMutation.isPending}
            onClick={() => signMutation.mutate()}
            className="h-auto rounded-lg px-3.5 py-1.5 text-[12px] font-bold disabled:opacity-40"
          >
            {signMutation.isPending ? "Signing…" : warning ? "Sign off anyway" : "Sign off"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
