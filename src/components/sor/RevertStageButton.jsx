import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import { opportunityService } from "../../services/opportunityService";
import { canRevertStage } from "../../utils/stageRevert";
import { Button } from "../ui/button";

/**
 * Issue #386 — "Revert to last stage". Shown only when a revert is both
 * allowed for the viewer and possible for the SOR; `sor_revert_stage` is the
 * real gate, this only keeps the action from being offered in vain.
 */
export default function RevertStageButton({ opportunity }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: visits = [] } = useQuery({
    queryKey: ["revertVisits", opportunity.id, opportunity.flow_stage_id],
    queryFn: () => opportunityService.getVisitsForRevert(opportunity.id),
  });

  const revert = useMutation({
    mutationFn: () => opportunityService.revertStage(opportunity.id),
    onSuccess: () => {
      toast.success("Reverted to the last stage.");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!canRevertStage({ visits, opportunity, user })) return null;

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="gap-1"
      disabled={revert.isPending}
      onClick={() => revert.mutate()}
    >
      <Undo2 size={12} />
      Revert to last stage
    </Button>
  );
}
