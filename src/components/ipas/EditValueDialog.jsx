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
import { Input } from "@/components/ui/input";

/**
 * One text value, typed or overridden (#243). Used for the supplier contact and
 * P.I # (typed and kept; Odoo fills them only while blank) and for the three
 * overrides, where `odooValue` is shown so the person sees what Odoo says
 * before putting their own over it.
 *
 * Mounted only while open, so the field starts from the value as it stands.
 * `onSubmit(value)` returns a promise; the dialog closes when it resolves, and
 * the caller words a failure (a toast).
 */
export default function EditValueDialog({ open, onOpenChange, ...body }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <Body {...body} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({
  title,
  description,
  label,
  initialValue = "",
  odooValue = null,
  allowBlank = false,
  submitLabel = "Save",
  onSubmit,
  onClose,
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim();
  const unchanged = trimmed === (initialValue ?? "").trim();
  const ready = !unchanged && (allowBlank || trimmed !== "");

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // The caller toasts; keep the dialog open so the value isn't lost.
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

      <div className="space-y-3">
        <FieldBox label={label} bare>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready && !saving) submit();
            }}
            autoFocus
          />
        </FieldBox>
        {odooValue !== undefined && odooValue !== null && (
          <p className="text-xs text-muted-foreground">
            Odoo: <span className="font-medium text-foreground">{odooValue}</span>
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onClose}>
          Cancel
        </Button>
        <Button size="lg" disabled={!ready || saving} onClick={submit}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
