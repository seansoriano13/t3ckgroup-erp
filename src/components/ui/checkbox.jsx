import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

// Checked colour. `primary` (Signal Red) is the default and app-wide; `neutral`
// is the opt-in mauve tick for lists where a red tick reads as an alarm.
const CHECKED_TONE = {
  primary: "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
  neutral: "data-checked:border-mauve-12 data-checked:bg-mauve-12 data-checked:text-mauve-1",
}

function Checkbox({ className, tone = "primary", ...props }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        CHECKED_TONE[tone] ?? CHECKED_TONE.primary,
        className
      )}
      {...props}>
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox }
