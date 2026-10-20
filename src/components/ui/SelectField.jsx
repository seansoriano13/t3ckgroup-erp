import { useId } from "react";
import { cn } from "@/lib/utils";
import { LabeledCard } from "./labeledCard";
import { useDropdownNestedPopoverRef } from "./dropdownNesting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/**
 * Simple Select: `options` / `value` / `onChange`. Wraps the base-ui building
 * blocks in select.jsx. `options` are `{ value, label, disabled? }`;
 * `onChange` receives the chosen value. `""`/`null`/`undefined` mean nothing
 * chosen unless an option really has that value.
 */
export function SelectField({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  size,
  className,
  contentClassName,
  label,
  error,
  containerClassName,
  ...props
}) {
  const labelId = useId();
  const popupRef = useDropdownNestedPopoverRef();
  const selected = options.find((o) => o.value === value);
  // "" with no "" option means nothing chosen, so the placeholder shows.
  const unset = value == null || (value === "" && !selected);
  const select = (
    <Select
      value={unset ? null : value}
      onValueChange={(next) => onChange?.(next)}
      disabled={disabled}
      items={options}
    >
      <SelectTrigger
        size={size}
        className={label ? cn("h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent", className) : className}
        aria-labelledby={label ? labelId : undefined}
        {...props}
      >
        <SelectValue placeholder={placeholder}>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent ref={popupRef} className={contentClassName} alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (!label) return select;
  return (
    <LabeledCard label={label} labelId={labelId} error={error} disabled={disabled} className={containerClassName}>
      {select}
    </LabeledCard>
  );
}
