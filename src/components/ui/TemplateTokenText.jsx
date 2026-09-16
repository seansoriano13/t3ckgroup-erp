import { renderTemplateLabelSegments } from "@/constants/taskTemplates"
import { cn } from "@/lib/utils"

/**
 * Issue #204 — anywhere a saved title/description is shown read-only (the
 * canvas satellite card, the Settings action list), a raw `{{so_number}}`
 * read as noise rather than a working part. Masks it as the same colored
 * "SO Number" chip `HighlightedTemplateField` shows while typing it, so a
 * template reads the same wherever it appears.
 */
export default function TemplateTokenText({ text, chipClassName }) {
  return renderTemplateLabelSegments(text).map((seg, i) =>
    seg.isToken ? (
      <span key={i} className={cn("rounded-[3px] bg-violet-a4 px-1 font-bold text-violet-11", chipClassName)}>
        {seg.text}
      </span>
    ) : (
      seg.text
    ),
  )
}
