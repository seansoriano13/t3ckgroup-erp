import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import { opportunityService } from "../../services/opportunityService";
import { canRevertStage } from "../../utils/stageRevert";
import { Button } from "../ui/button";
import RevertMoveDialog from "./RevertMoveDialog";

/**
 * Issue #386 — "Revert to last stage". Shown only when a revert is both
 * allowed for the viewer and possible for the SOR; `sor_revert_stage` is the
 * real gate, this only keeps the action from being offered in vain.
 *
 * Issue #392 — whether Stage Work needs a progress choice is asked up front
 * via `sor_revert_needs_progress_choice`, the same way #390's Return prompt
 * asks `getReturnStageIds` before calling `move`: a click either opens the
 * Keep/Remove dialog or reverts straight away, never a blind attempt that
 * relies on parsing a refusal. Someone shut out of the Stage being left is
 * never asked — the pre-check itself comes back false for them.
 */
export default function RevertStageButton({ opportunity, stageName = "this Stage" }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const { data: visits = [] } = useQuery({
    queryKey: ["revertVisits", opportunity.id, opportunity.flow_stage_id],
    queryFn: () => opportunityService.getVisitsForRevert(opportunity.id),
  });

  const revert = useMutation({
    mutationFn: (progressChoice) => opportunityService.revertStage(opportunity.id, progressChoice),
    onSuccess: () => {
      setIsOpen(false);
      toast.success("Reverted to the last stage.");
      queryClient.invalidateQueries();
    },
    onError: (err) => {
      setIsOpen(false);
      toast.error(err.message);
    },
  });

  if (!canRevertStage({ visits, opportunity, user })) return null;

  const handleClick = async () => {
    let needsChoice = false;
    try {
      needsChoice = await opportunityService.revertNeedsProgressChoice(opportunity.id);
    } catch {
      // sor_revert_stage itself still refuses a Revert made without a needed choice.
    }
    if (needsChoice) {
      setIsOpen(true);
      return;
    }
    revert.mutate(null);
  };

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="gap-1"
        disabled={revert.isPending}
        onClick={handleClick}
      >
        <Undo2 size={12} />
        Revert to last stage
      </Button>
      <RevertMoveDialog
        isOpen={isOpen}
        stageName={stageName}
        onCancel={() => setIsOpen(false)}
        onConfirm={(progressChoice) => revert.mutate(progressChoice)}
      />
    </>
  );
}
