import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import CanvassPanel from "../CanvassPanel";
import { useAuth } from "../../context/AuthContext";
import { canvassService } from "../../services/canvassService";
import { MEMBER_SIDE } from "../../constants/purchaseRequest";
import { canvassBlockedReason } from "../../utils/itemCanvass";
import { useRefreshRequest } from "./requestHooks";

/** The panel, mounted only while open, so the signed-in user is read only then. */
function OpenCanvass({ item, request, canEdit, onOpenChange, onStarted }) {
  const { user } = useAuth();
  return (
    <CanvassPanel
      open
      onOpenChange={onOpenChange}
      subject={{ requestedItemId: item.id }}
      subjectLabel={item.name}
      userId={user?.id}
      canEdit={canEdit}
      opportunityId={request?.opportunity_id}
      onStarted={onStarted}
    />
  );
}

/**
 * Canvass from a product line (#682, spec #675). Purchasing gets a Canvass button on every open
 * line; starting one moves the line to Still canvassing (the database does that when the first
 * Offer is saved). The button is off, with the reason shown, on a Cancelled, bought or
 * already-canvassing line. Once a Canvass exists the button opens it (the line's notes column says
 * "Canvass {number} · {n} of 3 offers", #695). Everyone else sees the line, never the button.
 */
export default function ItemCanvass({ item, request, actor }) {
  const [open, setOpen] = useState(false);
  const refresh = useRefreshRequest(request?.id);
  const isPurchasing = actor?.side === MEMBER_SIDE.PURCHASING;

  const { data: canvass = null } = useQuery({
    queryKey: ["canvass", "requestedItem", item.id],
    queryFn: () => canvassService.getForRequestedItem(item.id),
  });

  if (!isPurchasing) return null;

  const reason = canvassBlockedReason(item);
  // A running Canvass is opened, not started again, so only the "start" button is switched off.
  const starting = !canvass;
  const disabled = starting && reason !== null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="item-canvass">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={disabled}
        aria-label={canvass ? `Open Canvass ${canvass.number} for ${item.name}` : `Canvass ${item.name}`}
        onClick={() => setOpen(true)}
      >
        <Scale size={12} aria-hidden="true" />
        {canvass ? "Open Canvass" : "Canvass"}
      </Button>
      {disabled && (
        <span className="text-muted-foreground" data-testid="item-canvass-reason">
          {reason}
        </span>
      )}
      {open && <OpenCanvass item={item} request={request} canEdit={isPurchasing} onOpenChange={setOpen} onStarted={refresh} />}
    </div>
  );
}
