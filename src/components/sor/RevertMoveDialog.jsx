import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import RevertChoice from "./RevertChoice";
import { REVERT_CHOICE } from "../../constants/revertChoice";

/** Issue #392 — the prompt Revert opens when Stage Work was done on the Stage being left. */
export default function RevertMoveDialog({ isOpen, stageName, onCancel, onConfirm }) {
  const [choice, setChoice] = useState(REVERT_CHOICE.KEEP);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Revert out of {stageName}?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-1 pb-1">
          <RevertChoice stageName={stageName} value={choice} onChange={setChoice} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={() => onConfirm(choice)}>
              Confirm revert
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
