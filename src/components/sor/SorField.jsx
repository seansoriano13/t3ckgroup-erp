/**
 * Field wrappers matching the boxed input styling used across HR forms
 * (see components/hr/EmployeeForm.jsx).
 */

import Dropdown from "../ui/Dropdown";
import { ChevronDown } from "lucide-react";
import { FilterOptionList } from "../ui/FilterDropdown";

const BOX =
  "bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all";
const LABEL =
  "text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block";
const CONTROL =
  "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium";

export function TextField({ label, required, className = "", ...props }) {
  return (
    <div className={`${BOX} ${className}`}>
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input className={CONTROL} required={required} {...props} />
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
      <textarea className={`${CONTROL} resize-none`} required={required} {...props} />
    </div>
  );
}
