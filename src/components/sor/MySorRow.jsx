import { Lock } from "lucide-react";
import { Button } from "../ui/button";

/**
 * One SOR the person was called into: which Stage it is on, why they can see
 * it and how far that reaches. Shared by My SORs and the Release Notes deck.
 */
const SOURCE_LABEL = {
  action: "a task on this Stage",
  assignment: "an assignment on this Stage",
  purchase_request: "a purchase request",
};

export default function MySorRow({ row, onOpen }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpen(row.opportunityId)}
      className="h-auto w-full flex-col items-start gap-2 rounded-2xl border border-mauve-6 bg-mauve-2 p-4 text-left transition-colors hover:border-mauve-8"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-black tracking-tight text-foreground">
          {row.salesReference || "No Sales Reference"}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {row.projectTitle || "Untitled"}
        </span>
        {!row.isOpen && (
          <span className="inline-flex items-center gap-1 rounded-md bg-mauve-4 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <Lock size={10} /> Closed
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Now on <span className="font-bold text-foreground">{row.currentStageName || "—"}</span>
      </p>

      {/* Q7: why they can see it, and how far it reaches — the same wording the
          Flow Canvas uses for the identical setting, so the two cannot drift. */}
      <ul className="space-y-1">
        {row.windows.map((w) => (
          <li key={w.id} className="text-xs leading-relaxed text-muted-foreground">
            {w.source === "mention" ? (
              <>
                Mentioned{w.mentionedBy ? <> by <span className="font-bold text-foreground">{w.mentionedBy}</span></> : ""} � sees {w.reachLabel}
              </>
            ) : (
              <>
            Called in at{" "}
            <span className="font-bold text-foreground">{w.calledInAtStageName || "this deal"}</span>
            {SOURCE_LABEL[w.source] ? ` by ${SOURCE_LABEL[w.source]}` : ""} — sees {w.reachLabel}
            {w.closedAt ? " (window closed)" : ""}
              </>
            )}
          </li>
        ))}
      </ul>
    </Button>
  );
}
