import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { AVAILABLE_RETURN_CHOICES, RETURN_CHOICE } from "../../constants/returnChoice";

/** Issue #390/#391 — what a Return does with the Stage's earlier work. */
const OPTIONS = [
  { value: RETURN_CHOICE.RESUME, label: "Resume previous work", help: "Carries the earlier visit's work into this one." },
  {
    value: RETURN_CHOICE.START_FRESH,
    label: "Start fresh",
    help: "Cancels the earlier visit's tasks and re-runs the Stage's actions. Its ticks and files stay on record.",
  },
].map((option) => ({ ...option, disabled: !AVAILABLE_RETURN_CHOICES.includes(option.value) }));

export default function ReturnChoice({ stageName, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={`Returning to ${stageName}`} className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Returning to {stageName}
      </p>
      {OPTIONS.map((option) => {
        const checked = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            variant="outline"
            onClick={() => onChange(option.value)}
            className={cn(
              "h-auto flex-col items-start gap-0 whitespace-normal px-3 py-2 text-left",
              checked && "border-foreground bg-muted",
            )}
          >
            <span className="text-sm font-semibold">{option.label}</span>
            <span className="text-xs font-normal text-muted-foreground">{option.help}</span>
          </Button>
        );
      })}
    </div>
  );
}
