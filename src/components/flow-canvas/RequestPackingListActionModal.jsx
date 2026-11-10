import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { Switch } from "@/components/ui/switch";
import { CAPTION_BASE } from "@/lib/captionStyle";

/**
 * Issue #464 — the Request Packing List action's own config: who to tell instead of the Warehouse staff
 * list (blank means the list), and whether it waits for a Decider. The action creates one draft Packing
 * List unless the SOR already has an open one.
 */
export default function RequestPackingListActionModal({ isOpen, onClose, initialData, onSubmit, isSubmitting }) {
  const [notify, setNotify] = useState(initialData?.notify ?? []);
  const [confirmMode, setConfirmMode] = useState(initialData?.confirmMode);
  const [decider, setDecider] = useState(initialData?.decider ?? []);

  const submit = () => {
    onSubmit({
      notify,
      confirmMode,
      decider: confirmMode === "confirm" ? decider : undefined,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Request Packing List</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Creates a draft Packing List for the SOR, unless it already has an open one. Whoever signs it is
            "Packed by". Nothing is sent to Odoo.
          </p>

          <FieldBox label="Who to tell" bare>
            <PeoplePicker value={notify} onChange={setNotify} placeholder="Add people or groups" />
            <p className="mt-1 text-[11px] text-muted-foreground">Leave blank to tell the Warehouse staff list.</p>
          </FieldBox>

          <div className="rounded-lg border border-dashed border-mauve-7 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Require confirmation before running</span>
              <Switch
                checked={confirmMode === "confirm"}
                onCheckedChange={(next) => setConfirmMode(next ? "confirm" : undefined)}
              />
            </div>
            {confirmMode === "confirm" && (
              <div className="mt-2 space-y-1">
                <span className={`${CAPTION_BASE} tracking-widest text-muted-foreground`}>
                  Decider (defaults to the Deal Owner)
                </span>
                <PeoplePicker value={decider} onChange={setDecider} allowRoles allowDepartments placeholder="Add Decider" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" disabled={isSubmitting} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
