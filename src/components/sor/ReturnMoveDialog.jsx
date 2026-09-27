import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import ReturnChoice from "./ReturnChoice";
import { RETURN_CHOICE } from "../../constants/returnChoice";

/** Issue #390 — the prompt a stage control opens before a Return commits. */
export default function ReturnMoveDialog({ isOpen, stageName, onCancel, onConfirm }) {
  const [choice, setChoice] = useState(RETURN_CHOICE.RESUME);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move back to {stageName}?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-1 pb-1">
          <ReturnChoice stageName={stageName} value={choice} onChange={setChoice} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={() => onConfirm(choice)}>
              Confirm move
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
