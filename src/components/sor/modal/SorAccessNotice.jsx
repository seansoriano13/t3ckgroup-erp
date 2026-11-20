import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The violet notice about why the viewer sees only part of the deal. It can be
 * folded down to one line so it stops taking room from the work underneath;
 * it opens again with one click. `children` are the notice's lines.
 */
export default function SorAccessNotice({ count, children }) {
  const [folded, setFolded] = useState(false)
  const Icon = folded ? ChevronDown : ChevronUp
  return (
    <div className="shrink-0 border-b border-border/60 bg-violet-a2 px-6 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {folded ? (
            <p className="text-xs leading-relaxed text-violet-11">
              Why you see part of this deal ({count}) — tap the arrow to read.
            </p>
          ) : (
            <ul className="space-y-0.5">{children}</ul>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setFolded((f) => !f)}
          aria-expanded={!folded}
          aria-label={folded ? "Show access notice" : "Fold access notice"}
          className="shrink-0 text-violet-11"
        >
          <Icon />
        </Button>
      </div>
    </div>
  )
}
