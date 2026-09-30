import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import Avatar from "../../../components/Avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { purchasingService } from "../../../services/purchasingService";

/**
 * Who is sourcing a request. The one control for it: the queue row and the
 * slide-over both draw it, so reassigning behaves the same from either.
 */
export function BuyerSelect({ request, buyers, currentUserId, className = "" }) {
  const queryClient = useQueryClient();

  const { mutate: assign, isPending } = useMutation({
    mutationFn: (newAssigneeId) => purchasingService.assignRequests([request.id], newAssigneeId, currentUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procurementQueue"] });
      toast.success("Request reassigned.");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Select
      value={request.assignee?.id || "unassigned"}
      onValueChange={(val) => {
        if (val !== "unassigned" && val !== request.assignee?.id) assign(val);
      }}
      disabled={isPending}
    >
      <SelectTrigger aria-label="Buyer" className={className}>
        <SelectValue>
          {request.assignee ? (
            <div className="flex items-center gap-2">
              <Avatar src={request.assignee.avatar_path} name={request.assignee.name} size="xs" />
              <span className="truncate text-xs font-medium text-foreground">{request.assignee.name}</span>
            </div>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-11">Unassigned</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="unassigned" disabled>
          Unassigned
        </SelectItem>
        {buyers.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            <div className="flex items-center gap-2">
              <Avatar src={b.avatar_path} name={b.name} size="xs" />
              <span className="truncate">{b.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
