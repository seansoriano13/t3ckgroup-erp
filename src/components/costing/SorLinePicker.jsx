import { useQuery } from "@tanstack/react-query";

import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { opportunityService } from "../../services/opportunityService";
import { formatAmount } from "../../utils/requestedItem";
import { costingKeys } from "./costingKeys";

/**
 * Picks SOR lines to cost (#267). Choosing one makes a Tender Line that copies
 * the line's name, quantity and unit and keeps them: a later save of the SOR
 * cannot rewrite what is being costed. The dialog stays open so several lines
 * can be added in a row.
 */
export default function SorLinePicker({ open, onOpenChange, opportunityId, onPick, busy }) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: costingKeys.sorLines(opportunityId),
    queryFn: () => opportunityService.getItems(opportunityId),
    enabled: open && Boolean(opportunityId),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="pr-10">
          <DialogTitle>Pick from an SOR line</DialogTitle>
          <DialogDescription>The Tender Line keeps its own copy of the name, quantity and unit.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground">Loading the SOR&apos;s products…</p>}
          {!isLoading && lines.length === 0 && <p className="text-sm text-muted-foreground">This SOR has no products yet.</p>}
          {lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{line.product_name}</p>
                <p className="text-xs text-muted-foreground">{formatAmount(line.quantity, line.unit)}</p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onPick(line)}>
                Add as Tender Line
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
