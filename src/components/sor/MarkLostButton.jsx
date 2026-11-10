import { useState } from "react";
import { CircleX } from "lucide-react";
import { Button } from "../ui/button";
import MarkLostDialogHost from "./MarkLostDialogHost";

/**
 * Issue #810 — "Mark as Lost" in the SOR window header, next to the Stage.
 * `mark_opportunity_lost` is the real gate (permission, reasons, Lost Stage);
 * this only opens the reason picker and reports what the database says.
 */
export default function MarkLostButton({ opportunity, lostStages = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => setIsOpen(true)}>
        <CircleX size={12} />
        Mark as Lost
      </Button>
      <MarkLostDialogHost
        opportunity={opportunity}
        lostStages={lostStages}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
