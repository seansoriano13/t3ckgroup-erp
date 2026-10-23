import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { isLineRequested } from "../../utils/requestedItem";
import { PickSorLinesDialog } from "./AddRequestedItems";
import { purchaseRequestKeys } from "./queryKeys";

/**
 * One quiet line under the items: how many lines on the SOR's Product List the
 * request has no live item for, with a button that opens the picker. Shown
 * only to whoever may add items, since the picker is theirs. A line with no
 * quantity can't be requested, so it isn't counted.
 */
export default function UnrequestedSorLinesHint({ request, items }) {
  const [open, setOpen] = useState(false);
  const requestId = request?.id;

  const { data: canAdd } = useQuery({
    queryKey: purchaseRequestKeys.canAddItems(requestId),
    queryFn: () => purchaseRequestService.canAddItems(requestId),
    enabled: !!requestId,
  });
  const { data: lines } = useQuery({
    queryKey: purchaseRequestKeys.pickableLines(requestId),
    queryFn: () => purchaseRequestService.pickableLines(requestId),
    enabled: !!requestId && canAdd === true && !!request?.opportunity_id,
  });

  const missing = (lines || []).filter((line) => Number(line.quantity) > 0 && !isLineRequested(line, items));
  if (!canAdd || missing.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="unrequested-sor-lines">
      <span>
        {missing.length === 1 ? "1 SOR line is" : `${missing.length} SOR lines are`} not requested yet.
      </span>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListPlus size={14} />
        Add
      </Button>
      <PickSorLinesDialog
        open={open}
        onOpenChange={setOpen}
        requestId={requestId}
        opportunityId={request.opportunity_id}
        items={items}
      />
    </div>
  );
}
