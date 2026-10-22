import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import { formatAgeDays } from "../../../../utils/listDates";
import { pluralize } from "../../../../utils/plural";
import { DeadlineText, StageChecklist } from "./trackerParts";

/**
 * One SOR in the slide-over: what is next first, who owes it and for how long,
 * then the whole purchase as a checklist. A record opens the place that owns it.
 */
export default function SorPanel({ sor, checkIds, labelOf, today, onOpenRow, onOpenOrder, onOpenSor }) {
  const move = sor.next.move;
  return (
    <>
      <SlideOverBody>
        <section aria-label="What is next" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">What is next</h3>
          {move ? (
            <div className={cn("rounded-xl border p-3", move.late ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/30")}>
              <p className={cn("text-base font-semibold", move.late && "text-destructive")}>{move.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {move.ref} · {move.ours ? `${move.ownerLabel} to move` : `waiting on ${move.ownerLabel.toLowerCase()}`} ·{" "}
                {formatAgeDays(move.days)}
                {move.late && " · late"}
              </p>
              {sor.next.more > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{pluralize(sor.next.more, "other thing")} open behind this one.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing open. Everything on this SOR is filed.</p>
          )}
          <DeadlineText deadline={sor.deadline} />
        </section>
        <section aria-label="Where it stands" className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Where it stands</h3>
          <StageChecklist sor={sor} checkIds={checkIds} labelOf={labelOf} today={today} onOpenRow={onOpenRow} onOpenOrder={onOpenOrder} />
        </section>
      </SlideOverBody>
      {!sor.noSor && (
        <SlideOverFooter>
          <Button variant="outline" className="w-full" onClick={() => onOpenSor(sor)}>
            {sor.direct ? "Open the request" : "Open SOR"}
          </Button>
        </SlideOverFooter>
      )}
    </>
  );
}
