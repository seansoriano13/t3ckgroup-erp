import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import CanvassPanel from "../CanvassPanel";
import { MEMBER_SIDE } from "../../constants/purchaseRequest";
import { purchaseRequestKeys } from "./queryKeys";

/**
 * The Canvass of a Requested Item (#280), opened from its row. An item that names no Component is
 * canvassed on its own; one that names a Component opens that Component's Canvass (the chip says
 * so). Where a Canvass exists, every reader of the request may open it (what they see inside is
 * what their access allows); where none exists, only the purchasing side gets the "Canvass"
 * action that starts one. The chip also says whether the purchasing approver has signed it off.
 */
/** The panel, with the signed-in employee. Mounted only while open, so a closed row reads no session. */
function OpenPanel(props) {
  const { user } = useAuth();
  return <CanvassPanel {...props} userId={user?.id} />;
}

export default function RequestedItemCanvass({ item, request, actor }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const canvass = item.canvass ?? null;
  const canWrite = actor?.side === MEMBER_SIDE.PURCHASING;
  if (!canvass && !canWrite) return null;

  const viaComponent = Boolean(item.component_id);
  const subject = viaComponent ? { componentId: item.component_id } : { requestedItemId: item.id };
  const subjectLabel = viaComponent && item.component ? `${item.component.number} ${item.component.name}` : item.name;

  const onOpenChange = (next) => {
    setOpen(next);
    // A Canvass opened, signed or unsigned in the panel changes the chip.
    if (!next) queryClient.invalidateQueries({ queryKey: purchaseRequestKeys.items(request?.id) });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="requested-item-canvass">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        aria-label={canvass ? `Open Canvass ${canvass.number} for ${item.name}` : `Canvass ${item.name}`}
        onClick={() => setOpen(true)}
      >
        <Scale size={12} aria-hidden="true" />
        {canvass ? canvass.number : "Canvass"}
      </Button>
      {canvass && viaComponent && item.component && <span>on Component {item.component.number}</span>}
      {canvass && (
        <span
          data-testid="canvass-signed-state"
          className={canvass.signed ? "font-semibold text-green-11" : "text-muted-foreground"}
        >
          {canvass.signed ? "Signed off" : "Not signed"}
        </span>
      )}
      {open && (
        <OpenPanel
          open={open}
          onOpenChange={onOpenChange}
          subject={subject}
          subjectLabel={subjectLabel}
          canEdit={canWrite}
          opportunityId={request?.opportunity_id}
        />
      )}
    </div>
  );
}
