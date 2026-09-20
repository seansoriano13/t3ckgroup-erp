import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Issue #206 — the confirmation a Board drag opens before it commits.
 *
 * The move itself still goes through `opportunityService.updateStatus`, the
 * same funnel the details modal's stage control uses (moveAlongFlow, for a
 * Sales Flow deal) — so a drag can never skip a rule the modal enforces. Known
 * blocking conditions are shown up front from the register's already-loaded
 * `blockedDeals` read (no extra round trip); the funnel's own refusal —
 * missing Stage Fields, an illegal edge, a condition this preview didn't
 * know about — is what actually keeps the move from happening, surfaced
 * inline if the confirm attempt is refused.
 */
export default function MoveConfirmDialog({
  isOpen,
  onClose,
  opportunity,
  targetStage,
  isLostTarget,
  knownBlockers = [],
  actorId,
  onMoved,
}) {
  const [lostReason, setLostReason] = useState("");

  const moveMutation = useMutation({
    mutationFn: () =>
      opportunityService.updateStatus(
        opportunity.id,
        targetStage.id,
        actorId,
        isLostTarget ? lostReason.trim() : null,
      ),
    onSuccess: () => {
      setLostReason("");
      onMoved?.();
      onClose();
    },
  });

  const handleClose = () => {
    if (moveMutation.isPending) return;
    moveMutation.reset();
    setLostReason("");
    onClose();
  };

  if (!opportunity || !targetStage) return null;

  const confirmDisabled =
    moveMutation.isPending || (isLostTarget && !lostReason.trim());

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to {targetStage.name}?</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-1 pb-1">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {opportunity.client_name}
            </span>{" "}
            — {opportunity.project_title}
          </p>

          {knownBlockers.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-11">
                <AlertTriangle size={12} /> Still outstanding
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground">
                {knownBlockers.map((b, i) => (
                  <li key={i}>{b.label}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The move is refused until these are met.
              </p>
            </div>
          )}

          {isLostTarget && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 focus-within:border-mauve-7">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Reason
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <textarea
                autoFocus
                rows={2}
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Why was this deal lost?"
                className="w-full resize-none bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          )}

          {moveMutation.isError && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
              {moveMutation.error.message}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button
              onClick={handleClose}
              variant="ghost" className="h-auto"
            >
              Cancel
            </Button>
            <Button
              disabled={confirmDisabled}
              onClick={() => moveMutation.mutate()}
              variant="default"
            >
              Confirm move
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
