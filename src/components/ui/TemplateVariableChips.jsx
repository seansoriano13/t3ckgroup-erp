import { Eye } from "lucide-react"

import { TEMPLATE_VARIABLES, renderTemplateSegments, SAMPLE_TEMPLATE_CONTEXT } from "@/constants/taskTemplates"
import { cn } from "@/lib/utils"

/**
 * Issue #204 — the affordance a task title/description template needed:
 * typing `{{so_number}}` by hand was never discoverable, so these chips
 * insert the token at the caret instead of asking anyone to type it.
 *
 * The preview is its own labeled card, not a stray line of muted text sitting
 * where a hint or a placeholder would — the "Preview" label plus the eye icon
 * plus its own background are what make it unmistakable as a preview rather
 * than more body copy. Each substituted value is colored the same violet as
 * the `{{token}}` it replaced, in the field above, so the two visibly tie
 * together as the same thing rendered two ways.
 */
export default function TemplateVariableChips({ value, onInsert, className }) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onInsert(`{{${v.key}}}`)}
            className="rounded-lg border border-dashed border-mauve-7 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            + {v.label}
          </button>
        ))}
      </div>

      {value?.trim() && (
        <div className="flex items-start gap-2 rounded-lg bg-violet-a2 px-3 py-2">
          <Eye size={12} className="mt-0.5 shrink-0 text-violet-11" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-violet-11/70">Preview</p>
            <p className="truncate text-xs font-medium leading-relaxed text-foreground">
              {renderTemplateSegments(value, SAMPLE_TEMPLATE_CONTEXT).map((seg, i) =>
                seg.isToken ? (
                  <span key={i} className="mx-0.5 rounded-md bg-violet-a4 px-1.5 py-0.5 font-bold text-violet-11">
                    {seg.text}
                  </span>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
