import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LabeledCard } from "./labeledCard";
import { useDropdownNestedPopoverRef } from "./dropdownNesting";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/**
 * Simple Select: `options` / `value` / `onChange`. Wraps the base-ui building
 * blocks in select.jsx. `options` are `{ value, label, disabled? }`;
 * `onChange` receives the chosen value. `""`/`null`/`undefined` mean nothing
 * chosen unless an option really has that value.
 *
 * `required` makes it a real form control (#870): a blank one stops the form
 * from submitting, turns red and says "Choose an option." until something is
 * picked. `requiredMessage` changes that text.
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
  required,
  name,
  requiredMessage = "Choose an option.",
  ...props
}) {
  const labelId = useId();
  // The browser checks Base UI's hidden input on submit and fires `invalid`
  // on it when this is blank. That is the only signal, so listen for it.
  const inputRef = useRef(null);
  const [blankOnSubmit, setBlankOnSubmit] = useState(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !required) return undefined;
    const onInvalid = () => setBlankOnSubmit(true);
    input.addEventListener("invalid", onInvalid);
    return () => input.removeEventListener("invalid", onInvalid);
  }, [required]);
  const popupRef = useDropdownNestedPopoverRef();
  const selected = options.find((o) => o.value === value);
  // "" with no "" option means nothing chosen, so the placeholder shows.
  const unset = value == null || (value === "" && !selected);
  const showRequired = required && blankOnSubmit && unset;
  const shownError = error || (showRequired ? requiredMessage : null);
  const select = (
    <Select
      value={unset ? null : value}
      onValueChange={(next) => {
        setBlankOnSubmit(false);
        onChange?.(next);
      }}
      disabled={disabled}
      items={options}
      required={required}
      // Base UI pins an unnamed hidden input to the window's top-left corner,
      // so the browser's "Please fill out this field" bubble would point
      // there. A named one sits beside the trigger, so a required select
      // always gets a name.
      name={name ?? (required ? `select-${labelId}` : undefined)}
      inputRef={inputRef}
    >
      <SelectTrigger
        size={size}
        className={label ? cn("h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent", className) : className}
        aria-labelledby={label ? labelId : undefined}
        aria-required={required || undefined}
        aria-invalid={shownError ? true : undefined}
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
  if (!label) {
    if (!showRequired) return select;
    return (
      <>
        {select}
        <span role="alert" className="text-label font-bold text-destructive">
          {requiredMessage}
        </span>
      </>
    );
  }
  return (
    <LabeledCard label={label} labelId={labelId} error={shownError} disabled={disabled} className={containerClassName}>
      {select}
    </LabeledCard>
  );
}
