import { Link } from "react-router";
import { Scale } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ITEM_STATUS, MEMBER_SIDE } from "../../constants/purchaseRequest";
import { CANVASSES_PATH } from "../../constants/canvass";
import { useCanvassOrigin } from "./canvassOrigin";

/**
 * The Canvass of a Requested Item (#280), opened from its row. An item that names no Component is
 * canvassed on its own; one that names a Component opens that Component's Canvass (the chip says
 * so). Where a Canvass exists, every reader of the request may open it (what they see inside is
 * what their access allows); where none exists, only the purchasing side gets the "Canvass"
 * action that starts one. The chip also says whether the purchasing approver has signed it off.
 */
export default function RequestedItemCanvass({ item, actor }) {
  const canvass = item.canvass ?? null;
  const origin = useCanvassOrigin();
  const canWrite = actor?.side === MEMBER_SIDE.PURCHASING;
  // A cancelled item can't be canvassed; one that already has a Canvass keeps its button to read it.
  if (!canvass && (!canWrite || item.status === ITEM_STATUS.CANCELLED)) return null;

  const viaComponent = Boolean(item.component_id);
  // The Canvasses page opens the item's Canvass, or the Component's when the item canvasses through one.
  const target = `${CANVASSES_PATH}?${viaComponent ? "component" : "item"}=${viaComponent ? item.component_id : item.id}`;

  // This request was opened from that very Canvass: go back to it rather than open it again.
  const cameFromHere = Boolean(canvass && origin && origin.canvassId === canvass.id);
  const label = canvass ? canvass.number : "Canvass";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="requested-item-canvass">
      {cameFromHere ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={origin.close}
          className="h-7 gap-1 px-2 text-xs"
          aria-label={`Back to Canvass ${canvass.number}`}
        >
          <Scale size={12} aria-hidden="true" />
          Back to {label}
        </Button>
      ) : (
        <Link
          to={target}
          className={buttonVariants({ variant: "outline", size: "sm", className: "h-7 gap-1 px-2 text-xs" })}
          aria-label={canvass ? `Open Canvass ${canvass.number} for ${item.name}` : `Canvass ${item.name}`}
        >
          <Scale size={12} aria-hidden="true" />
          {label}
        </Link>
      )}
      {canvass && viaComponent && item.component && <span>on Component {item.component.number}</span>}
      {canvass && (
        <span
          data-testid="canvass-signed-state"
          className={canvass.signed ? "font-semibold text-green-11" : "text-muted-foreground"}
        >
          {canvass.signed ? "Signed off" : "Not signed"}
        </span>
      )}
    </div>
  );
}
