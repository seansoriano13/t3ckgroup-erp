import { useState } from "react";

import ModalShell from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { RequiredMark } from "@/components/ipas/record/FormFields";
import { refusal } from "./requestHooks";

/**
 * One written reason, asked for at the moment it is needed (#970): why this supplier wins a line,
 * why it wins every line, the one reason for all the picked lines, why there is no other supplier,
 * why a Purchased line is being unlocked. The reason is required (red asterisk) and Confirm stays
 * off until there is one, since the database refuses a blank. `onSubmit(reason)` may throw; the
 * refusal is shown under the box and the dialog stays open with what was typed.
 */
export default function CanvassReasonDialog({ open, onOpenChange, crumbs, title, intro, label, placeholder, initial = "", confirmLabel = "Confirm", onSubmit }) {
  const [reason, setReason] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event?.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onOpenChange(false);
    } catch (err) {
      setError(refusal(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={crumbs}
      title={title}
      onSubmit={submit}
      className="z-[90]"
      actions={
        <Button type="submit" size="sm" disabled={!reason.trim() || busy}>
          {busy ? "Saving…" : confirmLabel}
        </Button>
      }
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
      <div className="space-y-1.5">
        <span className={`${CAPTION_BASE} tracking-wider text-muted-foreground`}>
          {label}
          <RequiredMark />
        </span>
        <Textarea
          aria-label={label}
          aria-required="true"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="min-h-0 resize-none rounded-md px-2.5 py-1.5 text-sm"
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
