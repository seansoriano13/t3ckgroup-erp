import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import AmountInput from "./AmountInput";

/**
 * One text value, typed or overridden (#243). Used for the supplier contact and
 * P.I # (typed and kept; Odoo fills them only while blank) and for the three
 * overrides, where `odooValue` is shown so the person sees what Odoo says
 * before putting their own over it.
 *
 * Mounted only while open, so the field starts from the value as it stands.
 * `onSubmit(value)` returns a promise; the dialog closes when it resolves, and
 * the caller words a failure (a toast). `prefix` fixes a currency in front of
 * the field (an amount); `placeholder` shows what an empty field looks like.
 */
export default function EditValueDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({
  title,
  description,
  label,
  initialValue = "",
  odooValue = null,
  allowBlank = false,
  submitLabel = "Save",
  prefix,
  placeholder,
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
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={["IPAS", title]}
      actions={
        <Button size="lg" disabled={!ready || saving} onClick={submit}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      }
    >
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="space-y-3">
        <FieldBox label={label} bare>
          {prefix ? (
            <AmountInput
              prefix={prefix}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready && !saving) submit();
              }}
              autoFocus
            />
          ) : (
            <Input
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready && !saving) submit();
              }}
              autoFocus
            />
          )}
        </FieldBox>
        {odooValue !== undefined && odooValue !== null && (
          <p className="text-xs text-muted-foreground">
            Odoo: <span className="font-medium text-foreground">{odooValue}</span>
          </p>
        )}
      </div>
    </ModalShell>
  );
}
