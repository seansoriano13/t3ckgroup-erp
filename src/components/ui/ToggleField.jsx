import * as React from "react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"

// A setting row: the control and the text that names it, inside one <label>,
// so the whole row is the click target and the text is the control's name.

/**
 * SwitchField: an on/off setting.
 * `variant="card"` (default): bordered card, text on the left, switch on the right.
 * `variant="inline"`: switch first, then the text, no border.
 */
export function SwitchField({ label, description, variant = "card", className, labelClassName, ...switchProps }) {
  const inline = variant === "inline"
  return (
    <label
      data-slot="switch-field"
      className={cn(
        "flex cursor-pointer items-center gap-3",
        inline ? "gap-2" : "justify-between rounded-xl border border-border bg-muted/30 p-3",
        switchProps.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {inline && <Switch {...switchProps} />}
      <span className="min-w-0">
        <span className={cn("block text-sm font-semibold text-foreground", inline && "text-[11px] text-muted-foreground", labelClassName)}>
          {label}
        </span>
        {description && (
          <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
        )}
      </span>
      {!inline && <Switch {...switchProps} />}
    </label>
  )
}

/** CheckboxField: a tickable row, checkbox first, then the text. */
export function CheckboxField({ label, className, labelClassName, ...checkboxProps }) {
  return (
    <label
      data-slot="checkbox-field"
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
        checkboxProps.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <Checkbox {...checkboxProps} />
      <span className={labelClassName}>{label}</span>
    </label>
  )
}
