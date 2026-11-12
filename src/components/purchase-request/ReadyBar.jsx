import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import Dot from "@/components/ui/Dot";
import { cn } from "@/lib/utils";

/**
 * #680 — "N of M ready" and one plain sentence on one line; the bar, the counts per status and
 * the buttons that jump to each section sit behind "Details" below 1536px (the laptop band and
 * phones), and show at once on a wide screen (#989).
 * #902: the bar fills by the ready share only, so it agrees with the headline. The counts per
 * status stay in the list under it.
 */
export default function ReadyBar({ summary, jumps }) {
  const shown = summary.segments.filter((s) => s.count > 0);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 2xl:space-y-3 2xl:py-4" data-testid="ready-bar">
      <div className="flex items-center gap-x-3">
        <p className="min-w-0 flex-1 truncate text-sm text-foreground">
          <span className="text-lg font-black tracking-tight 2xl:text-lg">
            {summary.ready} of {summary.total} ready
          </span>
          <span className="text-[13px]" data-testid="ready-sentence">
            {" · "}
            {summary.sentence}
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
          className="h-8 shrink-0 gap-1 px-2 text-xs 2xl:hidden"
        >
          Details
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div id={detailsId} className={cn("mt-3 space-y-3 2xl:mt-0", !open && "hidden 2xl:block")}>
        <p className="text-[13px] text-muted-foreground">Ready means Available or Received</p>
        <div
          role="meter"
          aria-label={`${summary.ready} of ${summary.total} ready`}
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.ready}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <span className="block h-full bg-green-9" style={{ width: `${summary.readyPercent}%` }} />
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {shown.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <Dot size="size-2" color={s.bar} aria-hidden="true" />
              <span className="font-semibold tabular-nums text-foreground">{s.count}</span>
              {s.label}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Jump to a section">
          {jumps.map((jump) => (
            <Button key={jump.key} type="button" variant="outline" size="sm" onClick={jump.onClick}>
              {jump.label} · {jump.count}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
