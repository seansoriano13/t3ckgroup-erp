import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";
import InlineError from "@/components/record/InlineError";
import { ipasErrorMessage } from "@/utils/ipas";

/**
 * Sending a section back (#247) or reopening a filed IPAS (#248): the reason is
 * required, because it is what the submitter (or whoever reads the history)
 * reads to know why. `onSubmit(reason)` returns a promise; the dialog closes
 * when it resolves, and the caller words a failure (a toast). It is mounted
 * only while open, so it always starts empty. The wording defaults to sending
 * back; `placeholder`, `submitLabel` and `busyLabel` change it.
 *
 * `inlineError`: on a failure the dialog stays open and says why in itself too,
 * with Retry (the same reason, submitted again) and Dismiss, alongside the toast.
 */
export default function SendBackDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({
  title,
  description,
  onSubmit,
  onClose,
  placeholder = "What does the submitter need to fix?",
  submitLabel = "Return",
  busyLabel = "Returning…",
  inlineError = false,
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);
  const trimmed = reason.trim();

  const submit = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (error) {
      // The caller toasts; keep the dialog open so the reason isn't lost.
      if (inlineError) setFailure(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", title]}
      actions={
        <Button size="lg" variant="destructive" disabled={trimmed === "" || saving} onClick={submit}>
          {saving ? busyLabel : submitLabel}
        </Button>
      }
    >
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
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

      {failure && (
        <InlineError message={failure} busy={saving} onRetry={submit} onDismiss={() => setFailure(null)} />
      )}
    </ModalShell>
  );
}
