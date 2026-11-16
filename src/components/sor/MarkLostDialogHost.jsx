import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { opportunityService } from "../../services/opportunityService";
import MarkLostDialog from "./MarkLostDialog";
import { invalidateOpportunityQueries } from "./invalidateOpportunityQueries";

/**
 * #814 — the reason picker plus the call behind it, controlled by whoever
 * opens it (the header button, the More-actions menu, a board drop).
 */
export default function MarkLostDialogHost({ opportunity, lostStages = [], isOpen, onClose, onDone, initialReasonCode, initialNote }) {
  const queryClient = useQueryClient();

  const markLost = useMutation({
    mutationFn: ({ reasonCode, note, lostStageId }) =>
      opportunityService.markLost(opportunity.id, reasonCode, note, lostStageId),
    onSuccess: () => {
      onClose();
      onDone?.();
      toast.success("Deal marked Lost.");
      invalidateOpportunityQueries(queryClient);
    },
    // #1045: a refusal stays in the dialog until it is dismissed, not a 3s toast.
    onError: () => {},
  });

  const handleClose = () => {
    markLost.reset();
    onClose();
  };

  return (
    <MarkLostDialog
      isOpen={isOpen}
      lostStages={lostStages}
      isPending={markLost.isPending}
      initialReasonCode={initialReasonCode}
      initialNote={initialNote}
      error={markLost.isError ? markLost.error?.message || "Could not mark this deal Lost." : null}
      onCancel={handleClose}
      onConfirm={(args) => {
        markLost.reset();
        markLost.mutate(args);
      }}
    />
  );
}
