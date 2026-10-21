import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Textarea } from "@/components/ui/textarea";
import InlineError from "@/components/record/InlineError";
import { ipasErrorMessage } from "@/utils/ipas";

/**
 * Putting an open IPAS On-Hold, or clearing it (#597). Setting it takes an optional
 * note, so others know why it stopped; clearing shows that note and returns the IPAS
 * to the status it has earned. `onSubmit(note)` returns a promise; the dialog closes
 * when it resolves and says why in itself when it fails, with Retry. Mounted only
 * while open, so the note always starts empty.
 */
export default function OnHoldDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({ number, onHold, note, onSubmit, onClose }) {
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const title = onHold ? `Clear On-Hold on ${number}` : `Put ${number} On-Hold`;

  const submit = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await onSubmit(onHold ? "" : typed.trim());
      onClose();
    } catch (error) {
      setFailure(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", title]}
      title={title}
      actions={
        <Button size="lg" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : onHold ? "Clear On-Hold" : "Put On-Hold"}
        </Button>
      }
    >
      {onHold ? (
        <>
          <p className="text-sm text-muted-foreground">
            It goes back to the status it has earned, and Order Monitoring chases it again.
          </p>
          {note && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground" data-testid="on-hold-note">
              {note}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            An On-Hold order is stopped on purpose. It waits on someone else in Order Monitoring and never counts as late.
          </p>
          <FieldBox label="Note (optional)" bare>
            <Textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Why is it on hold? A supplier issue, waiting on the client…"
              autoFocus
            />
          </FieldBox>
        </>
      )}

      {failure && <InlineError message={failure} busy={saving} onRetry={submit} onDismiss={() => setFailure(null)} />}
    </ModalShell>
  );
}
