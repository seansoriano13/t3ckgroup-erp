// Typed-field pieces shared by the IPAS edit form and its money fields (#581):
// a typed box, a picker, read-only values, and the soft "Needed" marking.

import AmountInput from "@/components/ipas/AmountInput";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import { CHROME, RecordSectionChrome } from "@/components/record/sectionChrome";
import { cn } from "@/lib/utils";
import { NEEDED_BOX, NONE, blank } from "./formHelpers";

export function NeededTag() {
  return (
    <span className="rounded-full border border-amber-a4 bg-amber-a2 px-1.5 py-px text-[9px] font-semibold tracking-wider text-amber-11 normal-case">
      Needed
    </span>
  );
}

export function OdooTag() {
  return (
    <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-bold tracking-wider text-muted-foreground normal-case">
      Odoo
    </span>
  );
}

function caption(label, required, needed) {
  return (
    <>
      {label}
      {required && !needed && (
        <span className="text-muted-foreground/60" aria-hidden="true">
          *
        </span>
      )}
      {needed && <NeededTag />}
    </>
  );
}

/** One typed field. `kind`: text | amount | date | textarea. `odoo` is Odoo's value for an override field. */
export function Field({ id, label, kind = "text", value, onChange, required, prefix, odoo, placeholder, disabled, error }) {
  const needed = required && blank(value);
  const box = needed ? NEEDED_BOX : "";
  let control;
  if (kind === "amount") {
    control = (
      <AmountInput id={id} prefix={prefix} value={value} disabled={disabled} placeholder="0.00" error={error} onChange={(e) => onChange(e.target.value)} className={box} />
    );
  } else if (kind === "textarea") {
    control = <Textarea id={id} rows={2} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={box} />;
  } else {
    control = (
      <Input
        id={id}
        type={kind === "date" ? "date" : "text"}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? (odoo ? `Odoo: ${odoo}` : undefined)}
        onChange={(e) => onChange(e.target.value)}
        className={box}
      />
    );
  }
  return (
    <div className="min-w-0">
      <FieldBox label={caption(label, required, needed)} htmlFor={id} bare>
        {control}
      </FieldBox>
      {odoo !== undefined && (
        <p className="mt-1 pl-1 text-xs text-muted-foreground">{blank(value) ? "Using Odoo's value" : `Odoo says ${odoo ?? "blank"}`}</p>
      )}
    </div>
  );
}

/** A picked field. `options` are { value, label }; `emptyLabel` adds a "none" choice that stores "". */
export function PickField({ id, label, options, value, onChange, required, disabled, placeholder, emptyLabel, hint }) {
  const needed = required && blank(value);
  const list = emptyLabel ? [{ value: NONE, label: emptyLabel }, ...options] : options;
  return (
    <div className="min-w-0">
      <FieldBox label={caption(label, required, needed)} htmlFor={id} bare>
        <SelectField
          id={id}
          size="sm"
          options={list}
          value={emptyLabel && value === "" ? NONE : value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(next) => onChange(next === NONE ? "" : next)}
          className={cn("h-10 w-full", needed && NEEDED_BOX)}
        />
      </FieldBox>
      {needed && hint && <p className="mt-1 pl-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A value from Odoo or worked out: plain text, no box, so nobody tries to type in it. */
export function ReadValue({ label, children, odoo = false }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 pl-1 text-label font-bold tracking-widest text-muted-foreground uppercase">
        {label}
        {odoo && <OdooTag />}
      </div>
      <p className="mt-1.5 truncate pl-1 text-sm font-medium text-foreground">{children || "—"}</p>
    </div>
  );
}

export function Tick({ label, checked, onChange, disabled }) {
  return (
    <FieldBox inline className="h-10 rounded-xl border border-border bg-card px-3">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(Boolean(next))} />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </FieldBox>
  );
}

export function GroupTitle({ children }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

export function Embedded({ children }) {
  return <RecordSectionChrome.Provider value={CHROME.INLINE}>{children}</RecordSectionChrome.Provider>;
}
