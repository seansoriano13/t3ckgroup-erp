import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { LOST_REASONS, LOST_REASON_OTHER } from "../../constants/sor";

/**
 * Issue #810 — the reason picker Mark as Lost opens. The reason list is fixed;
 * a note rides along with any reason and is required for "Other". The database
 * checks the same rules, this only keeps Confirm honest.
 *
 * `lostStages` is the flow's Lost Stages. Only with more than one does the
 * person pick, otherwise the database uses the one there is.
 */
export default function MarkLostDialog({ isOpen, lostStages = [], isPending = false, onCancel, onConfirm }) {
  const [reasonCode, setReasonCode] = useState(null);
  const [note, setNote] = useState("");
  const [lostStageId, setLostStageId] = useState(null);

  const mustPickStage = lostStages.length > 1;
  const trimmedNote = note.trim();
  const canConfirm =
    Boolean(reasonCode) &&
    (reasonCode !== LOST_REASON_OTHER || trimmedNote.length > 0) &&
    (!mustPickStage || Boolean(lostStageId)) &&
    !isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as Lost</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-1 pb-1">
          <div role="radiogroup" aria-label="Why was the deal lost?" className="flex flex-col gap-1.5">
            {LOST_REASONS.map((reason) => {
              const checked = reasonCode === reason.code;
              return (
                <Button
                  key={reason.code}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  variant="outline"
                  onClick={() => setReasonCode(reason.code)}
                  className={cn("justify-start", checked && "border-foreground bg-muted")}
                >
                  {reason.label}
                </Button>
              );
            })}
          </div>
          <Textarea
            label={reasonCode === LOST_REASON_OTHER ? "Note (required)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
          />
          {mustPickStage && (
            <div role="radiogroup" aria-label="Move to which Lost Stage?" className="flex flex-col gap-1.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Move to which Lost Stage?
              </p>
              {lostStages.map((stage) => (
                <Button
                  key={stage.id}
                  type="button"
                  role="radio"
                  aria-checked={lostStageId === stage.id}
                  variant="outline"
                  onClick={() => setLostStageId(stage.id)}
                  className={cn("justify-start", lostStageId === stage.id && "border-foreground bg-muted")}
                >
                  {stage.name}
                </Button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={() => onConfirm({ reasonCode, note: trimmedNote || null, lostStageId })}
            >
              Mark as Lost
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
