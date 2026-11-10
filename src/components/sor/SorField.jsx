/**
 * Field wrappers matching the boxed input styling used across HR forms
 * (see components/hr/EmployeeForm.jsx).
 */

import { createContext, useContext, useId } from "react";
import { Input } from "@/components/ui/input";
import Dropdown from "../ui/Dropdown";
import { SelectField as BaseSelectField } from "@/components/ui/SelectField";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { formatSorDate, ymdToDate } from "../../utils/sorDate";

import { Textarea } from "@/components/ui/textarea";
import { FieldBox } from "@/components/ui/FieldBox";
import { CAPTION_BASE } from "@/lib/captionStyle";
// Split so a field can swap its resting border colour out. Two border-colour
// utilities on one element resolve by stylesheet order rather than by the
// order they appear in the class attribute, so appending a highlight colour
// next to `border-border` is how a highlight ends up invisible.
const BOX_BASE =
  "bg-muted/30 border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all";
const BOX = `${BOX_BASE} border-border`;
const LABEL = `${CAPTION_BASE} text-muted-foreground tracking-widest mb-1 block`;
const CONTROL =
  "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium";

// A field whose value was just replaced from an outside source (today, the
// Odoo quotation lookup) wears the border briefly so the change is visible
// without a toast per field. Deliberately one step up from the focus border
// rather than a colour of its own: it should read as "this field moved", not
// as an alert.
const AUTOFILLED = "border-mauve-8 ring-1 ring-mauve-8";

// Inside a SorFieldGroup a field drops its own card (#871): the group is the
// card, and each field is a borderless row that lights up while in use. The
// thicker ring shows only for keyboard focus, so Tab users always see where
// they are.
const GROUPED_BASE =
  "rounded-lg p-3 flex flex-col group transition-all focus-within:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";
const GROUPED_AUTOFILLED = "ring-1 ring-mauve-8 bg-mauve-3";

const GroupedContext = createContext(false);

/** The outer box of one field: its own card, or a row inside a group. */
function useShell(className = "", autofilled = false) {
  const grouped = useContext(GroupedContext);
  const base = grouped
    ? `${GROUPED_BASE} ${autofilled ? GROUPED_AUTOFILLED : ""}`
    : autofilled
      ? `${BOX_BASE} ${AUTOFILLED} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring`
      : `${BOX} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring`;
  return {
    className: cn(base, className),
    "data-sor-field": grouped ? "grouped" : "card",
  };
}

/**
 * A titled section of the SOR form holding several fields in one card, so
 * related fields read as one block rather than a stack of separate boxes
 * (#871). `columns={2}` lays them out two across from the small breakpoint
 * up; `aside` sits at the right of the title (a notice, a count).
 */
export function SorFieldGroup({ label, aside = null, columns = 1, className = "", children }) {
  return (
    <fieldset className={cn("min-w-0 border-0 p-0 m-0", className)}>
      <legend className="w-full mb-2 px-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className={`${CAPTION_BASE} text-muted-foreground tracking-widest`}>{label}</span>
          {aside}
        </span>
      </legend>
      <div
        className={cn(
          "grid gap-1 rounded-xl border border-border bg-muted/20 p-1",
          columns === 2 && "sm:grid-cols-2",
        )}
      >
        <GroupedContext.Provider value={true}>{children}</GroupedContext.Provider>
      </div>
    </fieldset>
  );
}

export function TextField({
  label,
  required,
  className = "",
  autofilled = false,
  action = null,
  ...props
}) {
  const shell = useShell(className, autofilled);
  return (
    <div {...shell} data-autofilled={autofilled ? "true" : undefined}>
      {/* The label row carries any per-field action, so a control that acts on
          this one field sits with it rather than floating elsewhere in the
          form. Occupying the label's own line keeps the field's height and the
          grid's rhythm unchanged whether or not an action is present. */}
      <div className="flex items-baseline justify-between gap-2">
        <FieldBox label={<>{label}
          {required && <span className="text-red-500 ml-0.5">*</span>}</>} className={LABEL} />
        {action}
      </div>
      <Input className={`h-auto rounded-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 ${CONTROL}`} required={required} {...props} />
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
  const labelId = useId();
  const shell = useShell(className);
  // An optional field offers its placeholder as a choice, so a pick can be
  // taken back. A required one has nothing to go back to.
  const allOptions = !required && placeholder
    ? [{ value: "", label: placeholder }, ...options]
    : options;

  return (
    <div {...shell}>
      <span id={labelId} className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {/* The keyboard-ready select (#870): Tab reaches it, Enter/Space opens
          it, the arrows and Enter pick, and a blank required one stops the
          form. Restyled to sit flat inside this box like the text fields. */}
      <BaseSelectField
        options={allOptions}
        value={value ?? ""}
        onChange={(next) => onChange?.({ target: { value: next ?? "" } })}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-labelledby={labelId}
        className={`w-full h-auto rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent data-[popup-open]:bg-transparent data-[popup-open]:ring-0 text-sm font-medium data-placeholder:text-muted-foreground/50`}
      />
    </div>
  );
}

function dateToYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// A date on the SOR forms, shown as "Nov 5, 2026" (see utils/sorDate.js).
export function DateField({
  label,
  required,
  className = "",
  value,
  onChange,
  disabled = false,
  placeholder = "Select date…",
}) {
  const shell = useShell(className);
  const control = (isOpen = false) => (
    <div
      className={`${CONTROL} flex items-center justify-between ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <span className={value ? "" : "text-muted-foreground/50"}>
        {value ? formatSorDate(value) : placeholder}
      </span>
      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
    </div>
  );

  const fieldLabel = (
    <FieldBox label={<>{label}
      {required && <span className="text-red-500 ml-0.5">*</span>}</>} className={LABEL} />
  );

  if (disabled) {
    return (
      <div {...shell}>
        {fieldLabel}
        {control()}
      </div>
    );
  }

  return (
    <div {...shell}>
      {fieldLabel}
      <Dropdown
        usePortal={true}
        matchTriggerWidth={false}
        trigger={({ isOpen }) => control(isOpen)}
      >
        {({ close }) => (
          <div className="p-1">
            <DatePicker
              selected={ymdToDate(value)}
              onChange={(date) => {
                if (onChange) onChange({ target: { value: date ? dateToYmd(date) : "" } });
                close();
              }}
              inline
            />
          </div>
        )}
      </Dropdown>
    </div>
  );
}

export function TextAreaField({ label, required, className = "", ...props }) {
  const shell = useShell(className);
  return (
    <div {...shell}>
      <FieldBox label={<>{label}
        {required && <span className="text-red-500 ml-0.5">*</span>}</>} className={LABEL} />
      <Textarea variant="bare" className={`resize-none ${CONTROL}`} required={required} {...props} />
    </div>
  );
}
