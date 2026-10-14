import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A money field with its currency fixed in front of it ("PHP", "USD"), so what
 * gets typed reads as a real amount. The prefix is part of the field's look, not
 * its value: what the form holds is only the digits.
 */
export default function AmountInput({ prefix, className, containerClassName, ...props }) {
  return (
    <div className={cn("relative w-full", containerClassName)}>
      {prefix && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground"
        >
          {prefix}
        </span>
      )}
      <Input
        inputMode="decimal"
        className={cn(prefix && "pl-14", className)}
        {...props}
      />
    </div>
  );
}
