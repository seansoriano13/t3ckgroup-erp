import { useState } from "react";
import { Scale } from "lucide-react";

import { Button } from "../ui/button";
import CanvassPanel from "../CanvassPanel";

/**
 * The Canvass of a Component (#276), opened from its row. Where a Canvass exists, a chip shows its
 * number and how many Offers it holds; every reader of the matrix may open it (what they see inside
 * is what their tier allows). Where none exists, only Purchasing gets the "Canvass" action that
 * starts one. The signed state joins the chip when sign-off arrives (#279).
 */
export default function ComponentCanvass({ component, canvass, canWrite, opportunityId, actorId }) {
  const [open, setOpen] = useState(false);
  if (!canvass && !canWrite) return null;

  const label = `Component ${component.number || ""}`.trim();
  const offers = canvass?.offerCount ?? 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="component-canvass">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        aria-label={canvass ? `Open Canvass ${canvass.number} for ${label}` : `Canvass ${label}`}
        onClick={() => setOpen(true)}
      >
        <Scale size={12} aria-hidden="true" />
        {canvass ? canvass.number : "Canvass"}
      </Button>
      {canvass && (
        <span>
          {offers} offer{offers === 1 ? "" : "s"}
        </span>
      )}
      {open && (
        <CanvassPanel
          open={open}
          onOpenChange={setOpen}
          subject={{ componentId: component.id }}
          subjectLabel={`${component.number ? `${component.number} ` : ""}${component.name || "Component"}`}
          userId={actorId}
          canEdit={canWrite}
          opportunityId={opportunityId}
        />
      )}
    </div>
  );
}
