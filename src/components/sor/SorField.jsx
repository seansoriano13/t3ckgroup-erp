/**
 * Field wrappers matching the boxed input styling used across HR forms
 * (see components/hr/EmployeeForm.jsx).
 */

import Dropdown from "../ui/Dropdown";
import { ChevronDown } from "lucide-react";
import { FilterOptionList } from "../ui/FilterDropdown";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

// Split so a field can swap its resting border colour out. Two border-colour
// utilities on one element resolve by stylesheet order rather than by the
// order they appear in the class attribute, so appending a highlight colour
// next to `border-border` is how a highlight ends up invisible.
const BOX_BASE =
  "bg-muted/30 border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all";
const BOX = `${BOX_BASE} border-border`;
const LABEL =
  "text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block";
const CONTROL =
  "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium";

// A field whose value was just replaced from an outside source (today, the
// Odoo quotation lookup) wears the border briefly so the change is visible
// without a toast per field. Deliberately one step up from the focus border
// rather than a colour of its own: it should read as "this field moved", not
// as an alert.
const AUTOFILLED = "border-mauve-8 ring-1 ring-mauve-8";

export function TextField({
  label,
  required,
  className = "",
  autofilled = false,
  action = null,
  ...props
}) {
  return (
    <div
      className={`${autofilled ? `${BOX_BASE} ${AUTOFILLED}` : BOX} ${className}`}
      data-autofilled={autofilled ? "true" : undefined}
    >
      {/* The label row carries any per-field action, so a control that acts on
          this one field sits with it rather than floating elsewhere in the
          form. Occupying the label's own line keeps the field's height and the
          grid's rhythm unchanged whether or not an action is present. */}
      <div className="flex items-baseline justify-between gap-2">
        <label className={LABEL}>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {action}
      </div>
      <Input className={CONTROL} required={required} {...props} />
    </div>
  );
}

export function SelectField({
  label,
  required,
  options = [],
  placeholder = "Select…",
  className = "",
  value,
  onChange,
  disabled = false,
}) {
  const selectedOption = options?.find((o) => o.value === value);

  // Rendered without the Dropdown wrapper when disabled — passing `disabled`
  // down to Dropdown does nothing, so a "locked" field stayed fully clickable.
  const control = (isOpen = false) => (
    <div
      className={`${CONTROL} flex items-center justify-between ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span className={selectedOption ? "" : "text-muted-foreground/50"}>
        {selectedOption ? selectedOption.label : placeholder}
      </span>
      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
    </div>
  );

  if (disabled) {
    return (
      <div className={`${BOX} ${className}`}>
        <label className={LABEL}>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {control()}
      </div>
    );
  }

  const allOptions = !required && placeholder
    ? [{ value: "", label: placeholder }, ...(options || [])]
    : (options || []);

  return (
    <div className={`${BOX} ${className}`}>
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <Dropdown
        usePortal={true}
        trigger={({ isOpen }) => control(isOpen)}
      >
        {({ close }) => (
          <FilterOptionList
            options={allOptions}
            value={value}
            onChange={(val) => {
              if (onChange) onChange({ target: { value: val } });
              close();
            }}
            close={close}
          />
        )}
      </Dropdown>
    </div>
  );
}

export function TextAreaField({ label, required, className = "", ...props }) {
  return (
    <div className={`${BOX} ${className}`}>
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <Textarea className={`${CONTROL} min-h-0 border-0 rounded-none p-0 resize-none`} required={required} {...props} />
    </div>
  );
}
