import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import toast from "react-hot-toast";
import { opportunityService } from "../../services/opportunityService";
import { Button } from "../ui/button";

/**
 * Issue #813 — "Reopen" on a Lost deal, in the header spot "Mark as Lost" holds
 * on an open deal. `reopen_opportunity` is the real gate (Lost only, permission,
 * where the deal goes back to); this only calls it and reports what it says.
 */
export default function ReopenButton({ opportunity }) {
  const queryClient = useQueryClient();

  const reopen = useMutation({
    mutationFn: () => opportunityService.reopen(opportunity.id),
    onSuccess: () => {
      toast.success("Deal reopened.");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="gap-1"
      disabled={reopen.isPending}
      onClick={() => reopen.mutate()}
    >
      <RotateCcw size={12} />
      Reopen
    </Button>
  );
}
