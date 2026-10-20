import * as React from "react"

import { cn } from "@/lib/utils"
import { LabeledCard } from "./labeledCard"

// "bare" strips the field chrome for inline-edit textareas that sit inside a
// card or row that already draws the border.
const BARE =
  "min-h-0 rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent disabled:bg-transparent dark:disabled:bg-transparent"

function Textarea({
  className,
  variant,
  label,
  error,
  containerClassName,
  ...props
}) {
  const generatedId = React.useId();
  if (label) {
    const id = props.id ?? generatedId;
    return (
      <LabeledCard label={label} htmlFor={id} error={error} disabled={props.disabled} className={containerClassName}>
        <textarea
          data-slot="textarea"
          className={cn(
            "w-full min-h-[60px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium",
            className
          )}
          {...props}
          id={id} />
      </LabeledCard>
    );
  }
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-h-[80px] rounded-xl border border-input bg-transparent px-4 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        variant === "bare" && BARE,
        className
      )}
      {...props} />
  );
}

export { Textarea }
