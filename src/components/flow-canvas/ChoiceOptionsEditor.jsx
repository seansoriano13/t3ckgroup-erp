import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { duplicateChoiceOption, duplicateOptionMessage } from "./choiceOptions";

/**
 * The option list of a custom choice field, one row per option. `options`
 * are the raw rows (blanks included) so a half-typed row survives re-render;
 * callers save `cleanChoiceOptions(options)`.
 */
export default function ChoiceOptionsEditor({ options, onChange }) {
  const focusIndex = useRef(null);
  const inputs = useRef([]);
  const dup = duplicateChoiceOption(options);

  useEffect(() => {
    if (focusIndex.current == null) return;
    inputs.current[focusIndex.current]?.focus();
    focusIndex.current = null;
  });

  const add = (at = options.length) => {
    focusIndex.current = at;
    onChange([...options.slice(0, at), "", ...options.slice(at)]);
  };

  return (
    <fieldset className="mt-2 space-y-2">
      <legend className="mb-1 text-sm font-medium text-foreground">Options</legend>
      {options.map((option, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            ref={(el) => (inputs.current[i] = el)}
            aria-label={`Option ${i + 1}`}
            value={option}
            placeholder={`Option ${i + 1}`}
            onChange={(e) => onChange(options.map((o, j) => (j === i ? e.target.value : o)))}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              add(i + 1);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove option ${i + 1}`}
            onClick={() => onChange(options.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      {dup && <p className="text-xs text-destructive">{duplicateOptionMessage(dup)}</p>}
      <Button type="button" variant="outline" size="sm" onClick={() => add()}>
        <Plus /> Add option
      </Button>
    </fieldset>
  );
}
