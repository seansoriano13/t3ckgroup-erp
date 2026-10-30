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
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const markLost = useMutation({
    mutationFn: ({ reasonCode, note, lostStageId }) =>
      opportunityService.markLost(opportunity.id, reasonCode, note, lostStageId),
    onSuccess: () => {
      setIsOpen(false);
      toast.success("Deal marked Lost.");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <>
      <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => setIsOpen(true)}>
        <CircleX size={12} />
        Mark as Lost
      </Button>
      <MarkLostDialog
        isOpen={isOpen}
        lostStages={lostStages}
        isPending={markLost.isPending}
        onCancel={() => setIsOpen(false)}
        onConfirm={(args) => markLost.mutate(args)}
      />
    </>
  );
}
