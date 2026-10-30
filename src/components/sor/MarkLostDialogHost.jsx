import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { opportunityService } from "../../services/opportunityService";
import MarkLostDialog from "./MarkLostDialog";
import { invalidateOpportunityQueries } from "./invalidateOpportunityQueries";

/**
 * #814 — the reason picker plus the call behind it, controlled by whoever
 * opens it (the header button, the More-actions menu, a board drop).
 */
export default function MarkLostDialogHost({ opportunity, lostStages = [], isOpen, onClose, onDone }) {
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
    onError: (err) => toast.error(err.message),
  });

  return (
    <MarkLostDialog
      isOpen={isOpen}
      lostStages={lostStages}
      isPending={markLost.isPending}
      onCancel={onClose}
      onConfirm={(args) => markLost.mutate(args)}
    />
  );
}
