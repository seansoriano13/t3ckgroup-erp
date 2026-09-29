import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { REVERT_CHOICE } from "../../constants/revertChoice";

/** Issue #392 — what a Revert does with Stage Work done on the Stage being left. */
const OPTIONS = [
  {
    value: REVERT_CHOICE.KEEP,
    label: "Keep progress",
    help: "Holds the work so a later Return can resume it.",
  },
  {
    value: REVERT_CHOICE.REMOVE,
    label: "Remove progress",
    help: "Closes off its tasks and action runs. Never deleted — it stays visible in the History.",
  },
];

export default function RevertChoice({ stageName, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={`Leaving ${stageName}`} className="flex flex-col gap-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Stage Work was done on {stageName}
      </p>
      {OPTIONS.map((option) => {
        const checked = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
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
