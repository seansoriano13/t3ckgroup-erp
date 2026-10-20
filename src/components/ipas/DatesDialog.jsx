import { useState } from "react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { isIsoDate } from "../../utils/ipasPayments";

/**
 * One or more typed dates (#246): the four Supplier Origin dates, or the one date
 * of Import Clearance or Delivered. A blank clears a date. `fields` is
 * `[{ key, label, value }]`; `onSubmit(values)` gets `{ [key]: "YYYY-MM-DD" | "" }`
 * and returns a promise: the dialog closes when it resolves, and the caller words
 * a failure with a toast. A half-typed date only keeps Save disabled.
 *
 * Mounted only while open, so the fields start from the values as they stand.
 */
export default function DatesDialog({ open, onOpenChange, ...body }) {
  return open ? <Body {...body} onClose={() => onOpenChange(false)} /> : null;
}

function Body({ title, description, fields, submitLabel = "Save", onSubmit, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""])));
  const [saving, setSaving] = useState(false);

  const valid = fields.every((f) => values[f.key] === "" || isIsoDate(values[f.key]));
  const changed = fields.some((f) => (values[f.key] ?? "") !== (f.value ?? ""));

  const submit = async () => {
    setSaving(true);
    try {
      // Only what changed: an untouched date isn't rewritten.
      const changes = Object.fromEntries(fields.filter((f) => (values[f.key] ?? "") !== (f.value ?? "")).map((f) => [f.key, values[f.key]]));
      await onSubmit(changes);
      onClose();
    } catch {
      // The caller toasts; keep the dialog open so what was typed isn't lost.
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
        <Button size="lg" disabled={!valid || !changed || saving} onClick={submit}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      }
    >
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <FieldBox key={f.key} label={f.label} bare>
            <Input
              type="date"
              value={values[f.key]}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              error={values[f.key] !== "" && !isIsoDate(values[f.key]) ? "Not a date" : undefined}
            />
          </FieldBox>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Clear a date to take it off.</p>
    </ModalShell>
  );
}
