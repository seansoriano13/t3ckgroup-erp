import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The form-field Primitive: a caption plus the control it names.
 *
 * The caption is a real <label> tied to the control. With a single child
 * element, FieldBox gives that child an `id` (unless it has one) and points the
 * label at it, so clicking the caption focuses the control and assistive tech
 * announces it. Pass `htmlFor` when the control is not the direct child.
 *
 * Default: the control sits in a bordered box (the Notion-style field card).
 * `bare`: caption only, for controls that draw their own border (Input, Select,
 * Textarea).
 */
export function FieldBox({
  label,
  isEditing,
  noBorder = false,
  bare = false,
  htmlFor,
  className,
  labelClassName,
  children,
}) {
  const autoId = React.useId()
  const only = React.Children.count(children) === 1 ? React.Children.only(children) : null
  const canTarget = React.isValidElement(only)
  const controlId = htmlFor ?? (canTarget ? only.props.id ?? autoId : undefined)
  const control = canTarget && !htmlFor && only.props.id === undefined ? React.cloneElement(only, { id: autoId }) : children

  return (
    <div data-slot="field-box" className={cn("flex w-full flex-col gap-1.5", className)}>
      <label
        htmlFor={controlId}
        className={cn("pl-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground", labelClassName)}
      >
        {label}
      </label>
      {bare ? (
        control
      ) : (
        <div
          className={cn(
            "flex min-h-[38px] w-full items-center rounded-lg border bg-card transition-all",
            isEditing && !noBorder
              ? "border-border shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/10"
              : "border-transparent",
          )}
        >
          {control}
        </div>
      )}
    </div>
  )
}
