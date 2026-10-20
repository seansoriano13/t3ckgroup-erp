import { cn } from "@/lib/utils";

/**
 * The labelled-field card shared by Input, Textarea and SelectField: a bold
 * caption above the control inside a rounded card. `labelId` / `htmlFor`
 * tie the caption to the control so it is the control's accessible name.
 */
export function LabeledCard({
  label,
  labelId,
  htmlFor,
  error,
  disabled,
  className,
  labelClassName,
  children,
}) {
  return (
    <div
      className={cn(
        "bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all w-full",
        error &&
          "border-destructive focus-within:border-destructive ring-destructive/20",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      <label
        id={labelId}
        htmlFor={htmlFor}
        className={cn(
          "text-label font-bold text-muted-foreground uppercase tracking-widest mb-1 block",
          error && "text-destructive",
          labelClassName,
        )}
      >
        {label}
      </label>
      {children}
      {error && (
        <span className="text-[10px] font-bold text-destructive mt-1">
          {error}
        </span>
      )}
    </div>
  );
}
