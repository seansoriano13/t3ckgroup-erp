import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";

/**
 * Sending a section back (#247) or reopening a filed IPAS (#248): the reason is
 * required, because it is what the preparer (or whoever reads the history)
 * reads to know why. `onSubmit(reason)` returns a promise; the dialog closes
 * when it resolves, and the caller words a failure (a toast). It is mounted
 * only while open, so it always starts empty. The wording defaults to sending
 * back; `placeholder`, `submitLabel` and `busyLabel` change it.
 */
export default function SendBackDialog({ open, onOpenChange, ...body }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body {...body} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({
  title,
  description,
  onSubmit,
  onClose,
  placeholder = "What does the preparer need to fix?",
  submitLabel = "Send back",
  busyLabel = "Sending back…",
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const trimmed = reason.trim();

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // The caller toasts; keep the dialog open so the reason isn't lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="shrink-0 pr-10">
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      <FieldBox label="Reason" bare>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={placeholder}
          autoFocus
        />
      </FieldBox>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" variant="destructive" disabled={trimmed === "" || saving} onClick={submit}>
          {saving ? busyLabel : submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
