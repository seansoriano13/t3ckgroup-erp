import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip } from "../ui/Tooltip";
import StatusBadge from "../StatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { IPAS_IMPORT_ONLY_STATUSES, IPAS_STATUSES, IPAS_STATUS_LABELS, IPAS_STATUS_MEANINGS } from "../../constants/ipas";

/**
 * The IPAS Status guide: what each step means, in the team's words (IPAS_STATUS_MEANINGS). A step with
 * no meaning from the team shows its name only.
 */
export function IpasStatusGuideDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="ipas-status-guide">
        <DialogHeader>
          <DialogTitle>What the IPAS Status steps mean</DialogTitle>
          <DialogDescription>
            The status is the one step last picked from the dropdown. Any step may be picked, forward or back, and each change is posted in the Chat.
          </DialogDescription>
        </DialogHeader>
        <ol className="divide-y divide-border">
          {IPAS_STATUSES.map((step) => (
            <li key={step} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={step} label={IPAS_STATUS_LABELS[step]} />
                {IPAS_IMPORT_ONLY_STATUSES.includes(step) && <span className="text-xs text-muted-foreground">Import only</span>}
              </span>
              {IPAS_STATUS_MEANINGS[step] && <span className="text-sm text-muted-foreground">{IPAS_STATUS_MEANINGS[step]}</span>}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          On-Hold sits on top of whatever step the order is at, and clearing it leaves that step. It is set from the More menu.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** The small "?" beside the status: a tooltip on hover, the guide on click. */
export default function IpasStatusGuideButton({ open, onOpenChange }) {
  const [own, setOwn] = useState(false);
  const shown = open ?? own;
  const setShown = onOpenChange ?? setOwn;
  return (
    <>
      <Tooltip content="What do these mean?">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full text-muted-foreground"
          aria-label="What do the IPAS Status steps mean?"
          data-testid="ipas-status-guide-button"
          onClick={() => setShown(true)}
        >
          <CircleHelp size={15} />
        </Button>
      </Tooltip>
      <IpasStatusGuideDialog open={shown} onOpenChange={setShown} />
    </>
  );
}
