import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleX } from "lucide-react";
import toast from "react-hot-toast";
import { opportunityService } from "../../services/opportunityService";
import { Button } from "../ui/button";
import MarkLostDialog from "./MarkLostDialog";

/**
 * Issue #810 — "Mark as Lost" in the SOR window header, next to the Stage.
 * `mark_opportunity_lost` is the real gate (permission, reasons, Lost Stage);
 * this only opens the reason picker and reports what the database says.
 */
export default function MarkLostButton({ opportunity, lostStages = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => setIsOpen(true)}>
        <CircleX size={12} />
        Mark as Lost
      </Button>
      <MarkLostDialogHost
        opportunity={opportunity}
        lostStages={lostStages}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

/**
 * #814 — the reason picker plus the call behind it, controlled by whoever
 * opens it (the header button, the More-actions menu, a board drop).
 */
export function MarkLostDialogHost({ opportunity, lostStages = [], isOpen, onClose, onDone }) {
  const queryClient = useQueryClient();

  const markLost = useMutation({
    mutationFn: ({ reasonCode, note, lostStageId }) =>
      opportunityService.markLost(opportunity.id, reasonCode, note, lostStageId),
    onSuccess: () => {
      onClose();
      onDone?.();
      toast.success("Deal marked Lost.");
      queryClient.invalidateQueries();
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
