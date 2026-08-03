/**
 * Field wrappers matching the boxed input styling used across HR forms
 * (see components/hr/EmployeeForm.jsx).
 */

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
  ...props
}) {
  return (
    <div className={`${BOX} ${className}`}>
      <label className={LABEL}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select className={`${CONTROL} cursor-pointer`} required={required} {...props}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
