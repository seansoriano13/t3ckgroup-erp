import * as React from "react";
import { cn } from "@/lib/utils";
import { LabeledCard } from "./labeledCard";

const Input = React.forwardRef(function Input(
  {
    className,
    containerClassName,
    label,
    labelClassName,
    error,
    icon: Icon,
    type,
    ...props
  },
  ref,
) {
  const generatedId = React.useId();
  // If a label is provided, render the standardized labeled card container
  if (label) {
    const inputId = props.id ?? generatedId;
    return (
      <LabeledCard
        label={label}
        htmlFor={inputId}
        error={error}
        disabled={props.disabled}
        className={containerClassName}
        labelClassName={labelClassName}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon size={16} className="text-muted-foreground shrink-0" />}
          <input
            ref={ref}
            type={type}
            className={cn(
              "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium",
              className,
            )}
            {...props}
            id={inputId}
          />
        </div>
      </LabeledCard>
    );
  }

  // Standalone input (when used without a label, e.g. search bars, filters, compact forms)
  return (
    // Only positioned when it hosts its own icon. A positioned wrapper paints over
    // sibling absolute icons that callers place before <Input> (search bars).
    <div className={cn("flex items-center w-full", Icon && "relative", containerClassName)}>
      {Icon && (
        <Icon size={16} className="absolute left-3 text-muted-foreground pointer-events-none" />
      )}
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "h-10 w-full min-w-0 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 transition-colors outline-none focus-visible:border-mauve-7 focus-visible:ring-1 focus-visible:ring-mauve-7 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          Icon && "pl-9",
          error && "border-destructive focus-visible:border-destructive ring-destructive/20",
          className,
        )}
        {...props}
      />
    </div>
  );
});

Input.displayName = "Input";

export { Input };
