/**
 * Field wrappers matching the boxed input styling used across HR forms
 * (see components/hr/EmployeeForm.jsx).
 */

import Dropdown from "../ui/Dropdown";
import { ChevronDown } from "lucide-react";

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
  options,
  placeholder = "Select…",
  className = "",
  value,
  onChange,
  ...props
}) {
  const selectedOption = options?.find((o) => o.value === value);

  return (
    <div className={`${BOX} ${className}`}>
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <Dropdown
        usePortal={true}
        trigger={({ isOpen }) => (
          <div className={`${CONTROL} cursor-pointer flex items-center justify-between`}>
            <span className={selectedOption ? "" : "text-muted-foreground/50"}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
          </div>
        )}
      >
        {({ close }) => (
          <div className="flex flex-col max-h-[250px] overflow-y-auto">
            <button
              type="button"
              className={`text-left px-3 py-2 text-sm rounded-lg hover:bg-muted-foreground/10 transition-colors text-muted-foreground ${
                !value ? "bg-muted-foreground/10 font-semibold" : ""
              }`}
              onClick={() => {
                if (onChange) onChange({ target: { value: "" } });
                close();
              }}
            >
              {placeholder}
            </button>
            {options?.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`text-left px-3 py-2 text-sm rounded-lg hover:bg-muted-foreground/10 transition-colors ${
                  value === o.value ? "bg-muted-foreground/10 font-semibold text-foreground" : "text-foreground"
                }`}
                onClick={() => {
                  if (onChange) onChange({ target: { value: o.value } });
                  close();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
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
